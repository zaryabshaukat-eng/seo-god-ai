/**
 * Plugin registry. Owns the lifecycle (install, enable, disable, uninstall,
 * update), enforces host permission policy, version constraints and plugin
 * dependencies, and dispatches contribution calls to enabled plugins inside
 * their sandboxes. A plugin can never run a contribution it was not approved
 * for, and hook/contribution failures are contained so a misbehaving plugin
 * cannot take the host down.
 */

import { PluginError, PluginErrorCode } from './errors.js';
import { validateManifest } from './manifest.js';
import { approvePermissions, requireGranted, CONTRIBUTION_KINDS, type ContributionKind } from './permissions.js';
import { loadPlugin, requiredPermission, formatEvent, type ResolvedContribution, type ResolvedEventSubscriber } from './runtime.js';
import { createSandbox, type Sandbox, type SandboxOptions } from './sandbox.js';
import {
  type AnalyzerImpl,
  type PluginActionInput,
  type PluginActionResult,
  type PluginAnalyzerOutput,
  type PluginBundle,
  type PluginContributionsManifest,
  type PluginEvent,
  type PluginHookName,
  type PluginIntegrationImpl,
  type PluginManifest,
  type PluginReportInput,
  type PluginReportOutput,
  type PluginState,
} from './types.js';
import { compareVersions, isValidVersion, parseVersion, satisfies } from './versions.js';

/** Version of the plugin SDK runtime the registry reports to plugins. */
export const PLUGIN_SDK_VERSION = '0.3.6';

export interface PluginLogger {
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export interface PluginStateChange {
  pluginId: string;
  state: PluginState;
  previous: PluginState;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  state: PluginState;
  /** Permissions granted after host policy intersection. */
  permissions: readonly string[];
  requestedPermissions: readonly string[];
  dependencies: Record<string, string>;
  engines?: { pluginSdk?: string; api?: string };
  hooks: PluginHookName[];
  installedAt: string;
  updatedAt: string;
  contributionCounts: Record<ContributionKind, number>;
}

export interface PluginRegistryOptions {
  /** Permissions the host grants. Defaults to every plugin permission. */
  allowedPermissions?: readonly string[];
  sandbox?: SandboxOptions;
  /** Plugin SDK version reported to `engines.pluginSdk` checks. */
  sdkVersion?: string;
  /** Platform API version reported to `engines.api` checks. */
  apiVersion?: string;
  logger?: PluginLogger;
  now?: () => string;
  /** Fired after every lifecycle state transition. */
  onStateChange?: (change: PluginStateChange) => void;
}

interface PluginRecord {
  info: PluginInfo;
  sandbox: Sandbox;
  loaded: ReturnType<typeof loadPlugin>;
  granted: Set<string>;
}

const ALL_PERMISSIONS: readonly string[] = [
  'plugin.analyzers.run',
  'plugin.tools.execute',
  'plugin.integrations.use',
  'plugin.reports.generate',
  'plugin.events.subscribe',
  'plugin.execution.actions',
  'plugin.ui.extensions',
];

function emptyCounts(): Record<ContributionKind, number> {
  return { analyzers: 0, tools: 0, integrations: 0, reportGenerators: 0, eventSubscribers: 0, executionActions: 0, uiExtensions: 0 };
}

function countContributions(manifest: PluginContributionsManifest): Record<ContributionKind, number> {
  const counts = emptyCounts();
  for (const kind of CONTRIBUTION_KINDS) {
    counts[kind] = manifest[kind]?.length ?? 0;
  }
  return counts;
}

/**
 * Manages installed plugins and dispatches their contributions. All registry
 * methods that can be rejected throw `PluginError` with a stable code.
 */
export class PluginRegistry {
  private readonly records = new Map<string, PluginRecord>();
  private readonly allowedPermissions: readonly string[];
  private readonly sandboxOptions: SandboxOptions;
  private readonly sdkVersion: string;
  private readonly apiVersion?: string;
  private readonly logger: PluginLogger;
  private readonly now: () => string;
  private readonly onStateChange?: (change: PluginStateChange) => void;

  constructor(options: PluginRegistryOptions = {}) {
    this.allowedPermissions = options.allowedPermissions ?? ALL_PERMISSIONS;
    this.sandboxOptions = options.sandbox ?? {};
    this.sdkVersion = options.sdkVersion ?? PLUGIN_SDK_VERSION;
    this.apiVersion = options.apiVersion;
    this.logger = options.logger ?? {};
    this.now = options.now ?? (() => new Date().toISOString());
    this.onStateChange = options.onStateChange;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Installs a plugin bundle. Rejects on duplicate id, version or policy errors. */
  install(bundle: PluginBundle): PluginInfo {
    const manifest = validateManifest(bundle.manifest);
    if (this.records.has(manifest.id)) {
      throw new PluginError(PluginErrorCode.conflict, `Plugin '${manifest.id}' is already installed. Use update().`, {
        context: { id: manifest.id },
      });
    }
    this.checkEngines(manifest);
    this.checkDependencies(manifest);
    const granted = requireGranted(manifest.permissions, this.allowedPermissions);

    const sandbox = createSandbox({
      ...this.sandboxOptions,
      logger: this.pluginLogger(manifest.id),
    });
    const loaded = loadPlugin(bundle, sandbox);

    const installedAt = this.now();
    const info = this.buildInfo(manifest, 'installed', granted, installedAt, installedAt);
    this.records.set(manifest.id, { info, sandbox, loaded, granted: new Set(granted) });

    void this.runHook(this.requireRecord(manifest.id), 'install');
    this.emit({ pluginId: manifest.id, state: 'installed', previous: 'installed' });
    return this.require(manifest.id);
  }

  /** Enables a plugin, running its `activate` hook. */
  enable(id: string): PluginInfo {
    const record = this.requireRecord(id);
    if (record.info.state !== 'installed' && record.info.state !== 'disabled') {
      throw new PluginError(PluginErrorCode.stateConflict, `Plugin '${id}' cannot be enabled from state '${record.info.state}'.`, {
        context: { id, state: record.info.state },
      });
    }
    const previous = record.info.state;
    record.info.state = 'enabled';
    record.info.updatedAt = this.now();
    void this.runHook(record, 'activate');
    this.emit({ pluginId: id, state: 'enabled', previous });
    return this.require(id);
  }

  /** Disables a plugin, running its `deactivate` hook. */
  disable(id: string): PluginInfo {
    const record = this.requireRecord(id);
    if (record.info.state !== 'enabled') {
      throw new PluginError(PluginErrorCode.stateConflict, `Plugin '${id}' cannot be disabled from state '${record.info.state}'.`, {
        context: { id, state: record.info.state },
      });
    }
    const previous = record.info.state;
    record.info.state = 'disabled';
    record.info.updatedAt = this.now();
    void this.runHook(record, 'deactivate');
    this.emit({ pluginId: id, state: 'disabled', previous });
    return this.require(id);
  }

  /** Uninstalls a plugin, running `deactivate` (if enabled) and `uninstall`. */
  uninstall(id: string): PluginInfo {
    const record = this.requireRecord(id);
    if (record.info.state === 'enabled') {
      void this.runHook(record, 'deactivate');
    }
    void this.runHook(record, 'uninstall');
    const previous = record.info.state;
    const removed = { ...record.info, state: 'uninstalled' as PluginState };
    this.records.delete(id);
    this.emit({ pluginId: id, state: 'uninstalled', previous });
    return removed;
  }

  /**
   * Replaces a plugin's manifest and/or code. Downgrades are rejected; the
   * current lifecycle state is preserved and the `update` hook runs.
   */
  update(id: string, bundle: PluginBundle): PluginInfo {
    const record = this.requireRecord(id);
    const manifest = validateManifest(bundle.manifest);
    if (manifest.id !== id) {
      throw new PluginError(PluginErrorCode.conflict, `Update for '${id}' carries a different plugin id '${manifest.id}'.`, {
        context: { id, nextId: manifest.id },
      });
    }
    const current = parseVersion(record.info.version);
    const next = parseVersion(manifest.version);
    if (current === null || next === null || compareVersions(next, current) < 0) {
      throw new PluginError(PluginErrorCode.conflict, `Cannot downgrade plugin '${id}' from '${record.info.version}' to '${manifest.version}'.`, {
        context: { id, from: record.info.version, to: manifest.version },
      });
    }
    this.checkEngines(manifest);
    this.checkDependencies(manifest);
    const granted = requireGranted(manifest.permissions, this.allowedPermissions);

    const sandbox = createSandbox({
      ...this.sandboxOptions,
      logger: this.pluginLogger(id),
    });
    const loaded = loadPlugin(bundle, sandbox);
    const updatedAt = this.now();

    const info = this.buildInfo(manifest, record.info.state, granted, record.info.installedAt, updatedAt);
    const nextRecord: PluginRecord = { info, sandbox, loaded, granted: new Set(granted) };
    this.records.set(id, nextRecord);
    void this.runHook(nextRecord, 'update');
    return this.require(id);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Returns plugin info, or `undefined` when not installed. */
  get(id: string): PluginInfo | undefined {
    return this.records.get(id)?.info;
  }

  /** Returns plugin info, throwing `notFound` when absent. */
  require(id: string): PluginInfo {
    const info = this.get(id);
    if (info === undefined) {
      throw new PluginError(PluginErrorCode.notFound, `Plugin '${id}' is not installed.`, { context: { id } });
    }
    return info;
  }

  /** Lists installed plugins, optionally filtered by state. */
  list(filter: { state?: PluginState } = {}): PluginInfo[] {
    const infos = [...this.records.values()]
      .map((record) => record.info)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (filter.state === undefined) return infos;
    return infos.filter((info) => info.state === filter.state);
  }

  /** True when the plugin is installed and enabled. */
  isEnabled(id: string): boolean {
    return this.records.get(id)?.info.state === 'enabled';
  }

  // -------------------------------------------------------------------------
  // Contribution access + dispatch
  // -------------------------------------------------------------------------

  /** Contributions of every enabled plugin for one kind. */
  contributionsOf(kind: ContributionKind): ResolvedContribution[] {
    return this.enabledEntries(kind).map((entry) => entry.contribution);
  }

  /** All event types currently subscribed by enabled subscribers. */
  eventTypes(): string[] {
    const types = new Set<string>();
    for (const entry of this.enabledEntries('eventSubscribers')) {
      for (const event of (entry.contribution as ResolvedEventSubscriber).events ?? []) types.add(event);
    }
    return [...types];
  }

  /** Ids of enabled subscribers for an event type. */
  subscribersForType(type: string): string[] {
    return this.enabledEntries('eventSubscribers')
      .filter((entry) => ((entry.contribution as ResolvedEventSubscriber).events ?? []).includes(type))
      .map((entry) => entry.contribution.id);
  }

  /** Runs an enabled analyzer. */
  async runAnalyzer(id: string, context: Parameters<AnalyzerImpl>[0]): Promise<PluginAnalyzerOutput> {
    const { record, contribution } = this.findEnabled('analyzers', id);
    this.assertPermission(record, contribution);
    const result = await record.sandbox.invoke<unknown>(contribution.impl, undefined, [context]);
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new PluginError(PluginErrorCode.invalidOutput, `Analyzer '${id}' must return an object.`, { context: { id } });
    }
    return result as PluginAnalyzerOutput;
  }

  /** Executes an enabled AI tool. */
  async executeTool(id: string, args: Record<string, unknown>): Promise<unknown> {
    const { record, contribution } = this.findEnabled('tools', id);
    this.assertPermission(record, contribution);
    return record.sandbox.invoke(contribution.impl, undefined, [args]);
  }

  /** Connects an enabled integration with the provided config. */
  async connectIntegration(id: string, config: Record<string, unknown>): Promise<unknown> {
    const { record, contribution } = this.findEnabled('integrations', id);
    this.assertPermission(record, contribution);
    const impl = contribution.impl as PluginIntegrationImpl;
    if (typeof impl.connect !== 'function') {
      throw new PluginError(PluginErrorCode.invalidOutput, `Integration '${id}' does not implement connect().`, { context: { id } });
    }
    return record.sandbox.invoke(impl.connect, impl, [config]);
  }

  /** Calls an operation on an enabled integration. */
  async callIntegration(id: string, operation: string, args: Record<string, unknown>): Promise<unknown> {
    const { record, contribution } = this.findEnabled('integrations', id);
    this.assertPermission(record, contribution);
    const impl = contribution.impl as PluginIntegrationImpl;
    if (typeof impl.call !== 'function') {
      throw new PluginError(PluginErrorCode.invalidOutput, `Integration '${id}' does not implement call().`, { context: { id } });
    }
    return record.sandbox.invoke(impl.call, impl, [operation, args]);
  }

  /** Generates a report with an enabled generator. */
  async generateReport(id: string, input: PluginReportInput): Promise<PluginReportOutput | string> {
    const { record, contribution } = this.findEnabled('reportGenerators', id);
    this.assertPermission(record, contribution);
    const result = await record.sandbox.invoke<unknown>(contribution.impl, undefined, [input]);
    if (typeof result === 'string') return result;
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new PluginError(PluginErrorCode.invalidOutput, `Report generator '${id}' must return a string or an object.`, { context: { id } });
    }
    return result as PluginReportOutput;
  }

  /** Delivers an event to one enabled subscriber. */
  async handleEvent(id: string, event: PluginEvent): Promise<void> {
    const { record, contribution } = this.findEnabled('eventSubscribers', id);
    this.assertPermission(record, contribution);
    await record.sandbox.invoke<void>(contribution.impl, undefined, [formatEvent(event)]);
  }

  /** Delivers an event to every enabled subscriber of its type; failures are contained. */
  async dispatchEvent(type: string, event: PluginEvent): Promise<void> {
    for (const id of this.subscribersForType(type)) {
      await this.handleEvent(id, { ...event, type }).catch((error: unknown) => {
        this.logger.warn?.(`Plugin event handler '${id}' failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  /** Executes an enabled execution action. */
  async executeAction(id: string, input: PluginActionInput): Promise<PluginActionResult> {
    const { record, contribution } = this.findEnabled('executionActions', id);
    this.assertPermission(record, contribution);
    const result = await record.sandbox.invoke<unknown>(contribution.impl, undefined, [input]);
    if (typeof result !== 'object' || result === null || typeof (result as { ok?: unknown }).ok !== 'boolean') {
      throw new PluginError(PluginErrorCode.invalidOutput, `Execution action '${id}' must return { ok: boolean }.`, { context: { id } });
    }
    return result as PluginActionResult;
  }

  /** Renders an enabled UI extension. */
  async renderUiExtension(id: string, context: Record<string, unknown>): Promise<unknown> {
    const { record, contribution } = this.findEnabled('uiExtensions', id);
    this.assertPermission(record, contribution);
    return record.sandbox.invoke(contribution.impl, undefined, [context]);
  }

  /**
   * Runs `deactivate` on every enabled plugin and clears the registry. Used
   * by hosts on shutdown or test reset; does not run `uninstall` hooks.
   */
  dispose(): void {
    for (const record of this.records.values()) {
      if (record.info.state === 'enabled') {
        void this.runHook(record, 'deactivate');
      }
      record.sandbox.dispose();
    }
    this.records.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private buildInfo(
    manifest: PluginManifest,
    state: PluginState,
    granted: readonly string[],
    installedAt: string,
    updatedAt: string,
  ): PluginInfo {
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      state,
      permissions: [...granted],
      requestedPermissions: [...manifest.permissions],
      dependencies: { ...(manifest.dependencies ?? {}) },
      ...(manifest.engines === undefined ? {} : { engines: { ...manifest.engines } }),
      hooks: [...(Object.keys(manifest.hooks ?? {}) as PluginHookName[])],
      installedAt,
      updatedAt,
      contributionCounts: countContributions(manifest.contributions),
    };
  }

  private requireRecord(id: string): PluginRecord {
    const record = this.records.get(id);
    if (record === undefined) {
      throw new PluginError(PluginErrorCode.notFound, `Plugin '${id}' is not installed.`, { context: { id } });
    }
    return record;
  }

  private checkEngines(manifest: PluginManifest): void {
    const engines = manifest.engines;
    if (engines?.pluginSdk !== undefined && !satisfies(this.sdkVersion, engines.pluginSdk)) {
      throw new PluginError(PluginErrorCode.engineUnsatisfied, `Plugin '${manifest.id}' requires pluginSdk ${engines.pluginSdk}; runtime is ${this.sdkVersion}.`, {
        context: { id: manifest.id, engine: 'pluginSdk', required: engines.pluginSdk, runtime: this.sdkVersion },
      });
    }
    if (engines?.api !== undefined && this.apiVersion !== undefined && !satisfies(this.apiVersion, engines.api)) {
      throw new PluginError(PluginErrorCode.engineUnsatisfied, `Plugin '${manifest.id}' requires api ${engines.api}; platform is ${this.apiVersion}.`, {
        context: { id: manifest.id, engine: 'api', required: engines.api, runtime: this.apiVersion },
      });
    }
  }

  private checkDependencies(manifest: PluginManifest): void {
    const dependencies = manifest.dependencies ?? {};
    for (const [pluginId, constraint] of Object.entries(dependencies)) {
      const dependency = this.records.get(pluginId)?.info;
      if (dependency === undefined) {
        throw new PluginError(PluginErrorCode.dependencyUnsatisfied, `Plugin '${manifest.id}' depends on missing plugin '${pluginId}'.`, {
          context: { id: manifest.id, dependency: pluginId },
        });
      }
      if (!isValidVersion(dependency.version) || !satisfies(dependency.version, constraint)) {
        throw new PluginError(PluginErrorCode.dependencyUnsatisfied, `Plugin '${manifest.id}' requires '${pluginId}@${constraint}'; installed is '${dependency.version}'.`, {
          context: { id: manifest.id, dependency: pluginId, required: constraint, installed: dependency.version },
        });
      }
    }
  }

  private pluginLogger(pluginId: string): { log: (message: string) => void; info: (message: string) => void; warn: (message: string) => void; error: (message: string) => void } {
    const prefix = `[plugin:${pluginId}]`;
    return {
      log: (message) => this.logger.info?.(`${prefix} ${message}`),
      info: (message) => this.logger.info?.(`${prefix} ${message}`),
      warn: (message) => this.logger.warn?.(`${prefix} ${message}`),
      error: (message) => this.logger.error?.(`${prefix} ${message}`),
    };
  }

  private runHook(record: PluginRecord, name: PluginHookName): void {
    const hook = record.loaded.hooks[name];
    if (hook === undefined) return;
    record.sandbox.invoke<void>(hook, undefined, []).catch((error: unknown) => {
      this.logger.warn?.(`[plugin:${record.info.id}] ${name} hook failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private emit(change: PluginStateChange): void {
    this.onStateChange?.(change);
  }

  private enabledEntries(kind: ContributionKind): Array<{ record: PluginRecord; contribution: ResolvedContribution }> {
    const entries: Array<{ record: PluginRecord; contribution: ResolvedContribution }> = [];
    for (const record of this.records.values()) {
      if (record.info.state !== 'enabled') continue;
      for (const contribution of record.loaded.contributions[kind]) {
        entries.push({ record, contribution });
      }
    }
    return entries;
  }

  private findEnabled(kind: ContributionKind, id: string): { record: PluginRecord; contribution: ResolvedContribution } {
    const entry = this.enabledEntries(kind).find((item) => item.contribution.id === id);
    if (entry === undefined) {
      throw new PluginError(PluginErrorCode.notFound, `No enabled ${kind} contribution '${id}'.`, { context: { kind, id } });
    }
    return entry;
  }

  private assertPermission(record: PluginRecord, contribution: ResolvedContribution): void {
    const permission = requiredPermission(contribution);
    if (!record.granted.has(permission)) {
      throw new PluginError(PluginErrorCode.permissionNotGranted, `Plugin '${record.info.id}' lacks permission '${permission}' for '${contribution.id}'.`, {
        context: { pluginId: record.info.id, permission, contributionId: contribution.id },
      });
    }
  }
}

export { approvePermissions };

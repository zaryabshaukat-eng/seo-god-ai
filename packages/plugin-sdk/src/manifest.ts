/**
 * Manifest validation. A manifest is the contract a plugin declares before any
 * code runs: stable identity, a semantic version, requested permissions and
 * declared contributions. Validation is strict so an invalid bundle can never
 * reach the sandbox.
 */

import { PluginError, PluginErrorCode } from './errors.js';
import { CONTRIBUTION_KINDS, defaultPermissionFor, isPluginPermission, type ContributionKind } from './permissions.js';
import {
  PLUGIN_HOOK_NAMES,
  type PluginHookName,
  type PluginManifest,
} from './types.js';
import { isValidVersion } from './versions.js';

const EVENT_TYPE_PATTERN = /^[a-z0-9]+(\.[a-z0-9]+)+$/;
const ID_PATTERN = /^[a-zA-Z0-9@._/-]+$/;
const EXTENSION_POINT_PATTERN = /^[a-z0-9]+(\.[a-z0-9]+)*$/;

function fail(message: string, context: Record<string, unknown> = {}): never {
  throw new PluginError(PluginErrorCode.invalidManifest, message, { context });
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** Normalized contribution declaration carrying every optional field. */
export interface NormalizedContributionDeclaration {
  id: string;
  name: string;
  description?: string;
  permission?: string;
  parameters?: Record<string, unknown>;
  endpoints?: string[];
  kind?: string;
  events?: string[];
  extensionPoint?: string;
  title?: string;
  type?: string;
}

/** Normalizes a single contribution declaration against its kind. */
export function validateContributionDeclaration(
  kind: ContributionKind,
  raw: unknown,
): NormalizedContributionDeclaration {
  const value = requireRecord(raw, `contributions.${kind}[]`);
  const id = requireString(value.id, `${kind} id`);
  if (!ID_PATTERN.test(id)) fail(`Contribution id '${id}' is invalid.`, { kind, id });

  const declared: NormalizedContributionDeclaration = {
    id,
    name: typeof value.name === 'string' ? value.name : id,
    description: typeof value.description === 'string' ? value.description : undefined,
    permission: typeof value.permission === 'string' ? value.permission : undefined,
  };

  if (declared.permission !== undefined && !isPluginPermission(declared.permission)) {
    fail(`Contribution '${id}' declares unknown permission '${declared.permission}'.`, { kind, id });
  }

  if (kind === 'tools') {
    declared.parameters = typeof value.parameters === 'object' && value.parameters !== null
      ? (value.parameters as Record<string, unknown>)
      : undefined;
  }
  if (kind === 'integrations') {
    declared.endpoints = Array.isArray(value.endpoints)
      ? value.endpoints.map(String)
      : undefined;
  }
  if (kind === 'reportGenerators') {
    const reportKind = requireString(value.kind, `${id} kind`);
    declared.kind = reportKind;
  }
  if (kind === 'eventSubscribers') {
    const events = Array.isArray(value.events) ? value.events.map(String) : [];
    if (events.length === 0) fail(`Event subscriber '${id}' must declare at least one event.`, { id });
    for (const event of events) {
      if (!EVENT_TYPE_PATTERN.test(event)) {
        fail(`Event subscriber '${id}' has invalid event type '${event}'.`, { id, event });
      }
    }
    declared.events = events;
  }
  if (kind === 'uiExtensions') {
    const extensionPoint = requireString(value.extensionPoint, `${id} extensionPoint`);
    if (!EXTENSION_POINT_PATTERN.test(extensionPoint)) {
      fail(`UI extension '${id}' has invalid extension point '${extensionPoint}'.`, { id });
    }
    declared.extensionPoint = extensionPoint;
    declared.title = typeof value.title === 'string' ? value.title : undefined;
    declared.type = typeof value.type === 'string' ? value.type : undefined;
  }
  return declared;
}

/**
 * Validates a raw manifest object and returns a typed `PluginManifest`.
 * Throws `PluginError` (invalidManifest) on the first violation.
 */
export function validateManifest(raw: unknown): PluginManifest {
  const value = requireRecord(raw, 'manifest');

  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== 1) fail('Unsupported manifest schemaVersion; expected 1.');

  const id = requireString(value.id, 'id');
  if (!ID_PATTERN.test(id)) fail(`Plugin id '${id}' is invalid.`, { id });

  const name = requireString(value.name, 'name');
  const version = requireString(value.version, 'version');
  if (!isValidVersion(version)) {
    throw new PluginError(PluginErrorCode.invalidVersion, `Plugin '${id}' has invalid version '${version}'.`, { context: { id, version } });
  }

  const permissionsRaw = value.permissions;
  if (!Array.isArray(permissionsRaw) || permissionsRaw.length === 0) {
    fail(`Plugin '${id}' must request at least one permission.`, { id });
  }
  const permissions = permissionsRaw.map(String);
  for (const permission of permissions) {
    if (!isPluginPermission(permission)) fail(`Plugin '${id}' requests unknown permission '${permission}'.`, { id, permission });
  }

  const enginesRaw = value.engines;
  const engines =
    typeof enginesRaw === 'object' && enginesRaw !== null
      ? { pluginSdk: stringOrUndefined((enginesRaw as Record<string, unknown>).pluginSdk), api: stringOrUndefined((enginesRaw as Record<string, unknown>).api) }
      : undefined;
  if (engines?.pluginSdk !== undefined && !isValidVersion(engines.pluginSdk) && !isConstraint(engines.pluginSdk)) {
    fail(`Plugin '${id}' has invalid pluginSdk engine constraint.`, { id });
  }
  if (engines?.api !== undefined && !isConstraint(engines.api)) {
    fail(`Plugin '${id}' has invalid api engine constraint.`, { id });
  }

  const dependenciesRaw = value.dependencies;
  const dependencies =
    typeof dependenciesRaw === 'object' && dependenciesRaw !== null && !Array.isArray(dependenciesRaw)
        ? Object.fromEntries(
            Object.entries(dependenciesRaw as Record<string, unknown>)
              .filter(([, constraint]) => typeof constraint === 'string' && constraint.length > 0)
              .map(([depId, constraint]) => [depId, constraint as string]),
          )
      : undefined;

  const hooksRaw = value.hooks;
  const hooks: Partial<Record<PluginHookName, string>> = {};
  if (typeof hooksRaw === 'object' && hooksRaw !== null) {
    for (const [hookName, fnId] of Object.entries(hooksRaw as Record<string, unknown>)) {
      if (!(PLUGIN_HOOK_NAMES as readonly string[]).includes(hookName)) {
        fail(`Plugin '${id}' declares unknown hook '${hookName}'.`, { id });
      }
      if (typeof fnId !== 'string' || fnId.length === 0) {
        fail(`Hook '${hookName}' of plugin '${id}' must reference a function id.`, { id });
      }
      (hooks as Record<string, string>)[hookName] = fnId;
    }
  }

  const contributionsRaw = requireRecord(value.contributions, 'contributions');
  const contributions: Record<ContributionKind, NormalizedContributionDeclaration[]> = {
    analyzers: [],
    tools: [],
    integrations: [],
    reportGenerators: [],
    eventSubscribers: [],
    executionActions: [],
    uiExtensions: [],
  };
  const seen = new Set<string>();
  for (const kind of CONTRIBUTION_KINDS) {
    const list = contributionsRaw[kind];
    const normalized: NormalizedContributionDeclaration[] = [];
    if (list !== undefined) {
      if (!Array.isArray(list)) fail(`contributions.${kind} must be an array.`);
      for (const item of list) {
        const declaration = validateContributionDeclaration(kind, item);
        if (seen.has(`${kind}:${declaration.id}`)) {
          fail(`Duplicate contribution id '${declaration.id}' in ${kind}.`);
        }
        seen.add(`${kind}:${declaration.id}`);
        normalized.push(declaration);
      }
    }
    contributions[kind] = normalized;
  }

  // A contribution kind may only be declared if its permission was requested.
  for (const kind of CONTRIBUTION_KINDS) {
    const list = contributions[kind];
    if (list.length === 0) continue;
    for (const declaration of list) {
      const permission = declaration.permission ?? defaultPermissionFor(kind);
      if (!permissions.includes(permission)) {
        fail(
          `Contribution '${declaration.id}' requires permission '${permission}' which is not requested in the manifest.`,
          { id, kind, contributionId: declaration.id, permission },
        );
      }
    }
  }

  return {
    schemaVersion: 1,
    id,
    name,
    version,
    description: stringOrUndefined(value.description),
    author: stringOrUndefined(value.author),
    permissions,
    ...(engines === undefined || (engines.pluginSdk === undefined && engines.api === undefined) ? {} : { engines }),
    ...(dependencies === undefined || Object.keys(dependencies).length === 0 ? {} : { dependencies }),
    ...(Object.keys(hooks).length === 0 ? {} : { hooks }),
    contributions: Object.fromEntries(CONTRIBUTION_KINDS.map((kind) => [kind, contributions[kind] ?? []])) as PluginManifest['contributions'],
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isConstraint(value: string): boolean {
  return /[<>=~^]/.test(value);
}

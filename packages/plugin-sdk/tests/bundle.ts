/**
 * Test fixtures: builders for plugin manifests and sandbox code strings.
 * Lives outside `src/` so it never affects package coverage.
 */

import type { PluginBundle } from '../src/types.js';

export type FnSpec = Record<string, string>;

export interface Fixture {
  hooks?: FnSpec;
  analyzers?: FnSpec;
  tools?: FnSpec;
  integrations?: FnSpec;
  reportGenerators?: FnSpec;
  eventSubscribers?: FnSpec;
  executionActions?: FnSpec;
  uiExtensions?: FnSpec;
}

function objectSource(entries: FnSpec | undefined): string {
  if (entries === undefined || Object.keys(entries).length === 0) return '';
  const body = Object.entries(entries)
    .map(([name, source]) => `${name}: (${source})`)
    .join(',\n    ');
  return `{\n    ${body},\n  }`;
}

/** Builds a single-expression plugin source that evaluates to a PluginCode object. */
export function pluginCode(fixture: Fixture): string {
  const sections: string[] = [];
  if (fixture.hooks !== undefined && Object.keys(fixture.hooks).length > 0) {
    sections.push(`hooks: ${objectSource(fixture.hooks)}`);
  }
  const kinds = ['analyzers', 'tools', 'integrations', 'reportGenerators', 'eventSubscribers', 'executionActions', 'uiExtensions'] as const;
  const contribs: string[] = [];
  for (const kind of kinds) {
    const src = objectSource(fixture[kind]);
    if (src.length > 0) contribs.push(`${kind}: ${src}`);
  }
  if (contribs.length > 0) sections.push(`contributions: {\n    ${contribs.join(',\n    ')},\n  }`);
  return `(function () {\n  return {\n    ${sections.join(',\n    ')}\n  };\n})()`;
}

export const DEFAULT_HOOK = 'function () { return undefined; }';
export const DEFAULT_ANALYZER = 'function (context) { return { score: 10, issues: [], recommendations: ["ok"] }; }';
export const DEFAULT_TOOL = 'function (args) { return { ok: true, args: args }; }';
export const DEFAULT_INTEGRATION =
  '({ connect: function (config) { return { connected: true, config: config }; }, call: function (operation, args) { return { operation: operation, args: args }; } })';
export const DEFAULT_REPORT = 'function (input) { return { summary: input.periodDays === undefined ? "report" : String(input.periodDays), sections: [] }; }';
export const DEFAULT_SUBSCRIBER = 'function (event) { return undefined; }';
export const DEFAULT_ACTION = 'function (input) { return { ok: true, output: { value: input.payload ? input.payload.value : undefined } }; }';
export const DEFAULT_UI = 'function (context) { return { html: "<div></div>" }; }';

export const FULL_CONTRIBUTIONS: Record<string, unknown> = {
  analyzers: [{ id: 'runAnalyzer', name: 'Run Analyzer' }],
  tools: [{ id: 'runTool', name: 'Run Tool' }],
  integrations: [{ id: 'shopify', name: 'Shopify' }],
  reportGenerators: [{ id: 'monthlyReport', name: 'Monthly', kind: 'monthly' }],
  eventSubscribers: [{ id: 'onPagePublished', name: 'Listener', events: ['page.published'] }],
  executionActions: [{ id: 'publish', name: 'Publish' }],
  uiExtensions: [{ id: 'dashboardPanel', name: 'Panel', extensionPoint: 'dashboard.panel' }],
};

export const DEFAULT_FIXTURE: Fixture = {
  hooks: { install: DEFAULT_HOOK, activate: DEFAULT_HOOK, deactivate: DEFAULT_HOOK, uninstall: DEFAULT_HOOK, update: DEFAULT_HOOK },
  analyzers: { runAnalyzer: DEFAULT_ANALYZER },
  tools: { runTool: DEFAULT_TOOL },
  integrations: { shopify: DEFAULT_INTEGRATION },
  reportGenerators: { monthlyReport: DEFAULT_REPORT },
  eventSubscribers: { onPagePublished: DEFAULT_SUBSCRIBER },
  executionActions: { publish: DEFAULT_ACTION },
  uiExtensions: { dashboardPanel: DEFAULT_UI },
};

const CONTRIBUTION_KINDS = ['analyzers', 'tools', 'integrations', 'reportGenerators', 'eventSubscribers', 'executionActions', 'uiExtensions'] as const;

export function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'fixture.plugin',
    name: 'Fixture Plugin',
    version: '1.0.0',
    permissions: [
      'plugin.analyzers.run',
      'plugin.tools.execute',
      'plugin.integrations.use',
      'plugin.reports.generate',
      'plugin.events.subscribe',
      'plugin.execution.actions',
      'plugin.ui.extensions',
    ],
    hooks: { install: 'install', activate: 'activate', deactivate: 'deactivate', uninstall: 'uninstall', update: 'update' },
    contributions: FULL_CONTRIBUTIONS,
    ...overrides,
  };
}

function declaredIds(manifest: Record<string, unknown>, kind: string): Set<string> {
  const raw = (manifest.contributions as Record<string, unknown> | undefined)?.[kind];
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.map((item) => (item as { id?: unknown }).id as string));
}

export function makeBundle(manifestOverrides: Record<string, unknown> = {}, fixture: Fixture = {}): PluginBundle {
  const manifest = baseManifest(manifestOverrides);
  const merged: Fixture = {
    ...DEFAULT_FIXTURE,
    ...fixture,
    hooks: { ...DEFAULT_FIXTURE.hooks, ...(fixture.hooks ?? {}) },
  };
  const filtered: Fixture = { hooks: merged.hooks };
  for (const kind of CONTRIBUTION_KINDS) {
    const ids = declaredIds(manifest, kind);
    const impls = merged[kind] ?? {};
    filtered[kind] = Object.fromEntries(Object.entries(impls).filter(([id]) => ids.has(id)));
  }
  return {
    manifest: manifest as unknown as PluginBundle['manifest'],
    code: pluginCode(filtered),
  };
}

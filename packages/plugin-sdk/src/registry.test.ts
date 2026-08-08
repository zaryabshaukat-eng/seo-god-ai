import { describe, expect, it } from 'vitest';
import { PluginError, PluginErrorCode } from '../src/errors.js';
import { PluginRegistry, type PluginLogger, type PluginStateChange } from '../src/registry.js';
import { makeBundle } from '../tests/bundle.js';

function makeRegistry(options: {
  allowedPermissions?: readonly string[];
  sdkVersion?: string;
  apiVersion?: string;
  logger?: PluginLogger;
  now?: () => string;
  globals?: Record<string, unknown>;
  timeoutMs?: number;
} = {}): { registry: PluginRegistry; changes: PluginStateChange[] } {
  const changes: PluginStateChange[] = [];
  const registry = new PluginRegistry({
    allowedPermissions: options.allowedPermissions,
    sdkVersion: options.sdkVersion,
    apiVersion: options.apiVersion,
    logger: options.logger,
    now: options.now,
    sandbox: options.globals === undefined ? undefined : { globals: options.globals },
    onStateChange: (change) => changes.push(change),
  });
  return { registry, changes };
}

function expectError(fn: () => unknown, code: string): PluginError {
  try {
    fn();
    throw new Error(`expected PluginError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(PluginError);
    const pluginError = error as PluginError;
    expect(pluginError.code).toBe(code);
    return pluginError;
  }
}

async function expectReject(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`expected PluginError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(PluginError);
    expect((error as PluginError).code).toBe(code);
  }
}

const MINIMAL = { contributions: {}, permissions: ['plugin.analyzers.run'] };

describe('install', () => {
  it('installs a full bundle and reports PluginInfo', () => {
    const { registry } = makeRegistry({ now: () => '2026-01-01T00:00:00.000Z' });
    const info = registry.install(makeBundle());
    expect(info.id).toBe('fixture.plugin');
    expect(info.name).toBe('Fixture Plugin');
    expect(info.version).toBe('1.0.0');
    expect(info.state).toBe('installed');
    expect(info.permissions).toHaveLength(7);
    expect(info.requestedPermissions).toHaveLength(7);
    expect(info.dependencies).toEqual({});
    expect(info.hooks).toEqual(['install', 'activate', 'deactivate', 'uninstall', 'update']);
    expect(info.installedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(info.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(info.contributionCounts).toEqual({
      analyzers: 1,
      tools: 1,
      integrations: 1,
      reportGenerators: 1,
      eventSubscribers: 1,
      executionActions: 1,
      uiExtensions: 1,
    });
  });

  it('rejects a duplicate plugin id', () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle());
    expectError(() => registry.install(makeBundle()), PluginErrorCode.conflict);
  });

  it('rejects install when the host does not grant the requested permissions', () => {
    const { registry } = makeRegistry({ allowedPermissions: ['plugin.analyzers.run'] });
    expectError(() => registry.install(makeBundle()), PluginErrorCode.permissionNotGranted);
  });

  it('rejects invalid plugin code', () => {
    const { registry } = makeRegistry();
    expectError(() => registry.install({ manifest: makeBundle().manifest, code: 'function (' }), PluginErrorCode.invalidCode);
  });

  it('rejects an unsatisfied pluginSdk engine', () => {
    const { registry } = makeRegistry({ sdkVersion: '0.2.0' });
    expectError(() => registry.install(makeBundle({ engines: { pluginSdk: '^0.3.0' } })), PluginErrorCode.engineUnsatisfied);
  });

  it('accepts a satisfied pluginSdk engine', () => {
    const { registry } = makeRegistry();
    expect(registry.install(makeBundle({ engines: { pluginSdk: '^0.3.0' } })).state).toBe('installed');
  });

  it('checks the api engine only when an api version is known', () => {
    const { registry } = makeRegistry({ apiVersion: '1.0.0' });
    expectError(() => registry.install(makeBundle({ engines: { api: '^2.0.0' } })), PluginErrorCode.engineUnsatisfied);
    const { registry: blind } = makeRegistry();
    expect(blind.install(makeBundle({ engines: { api: '^2.0.0' } })).state).toBe('installed');
  });

  it('rejects a missing dependency', () => {
    const { registry } = makeRegistry();
    expectError(
      () => registry.install(makeBundle({ id: 'dependent.plugin', dependencies: { 'fixture.plugin': '^1.0.0' }, ...MINIMAL })),
      PluginErrorCode.dependencyUnsatisfied,
    );
  });

  it('accepts satisfied dependencies and rejects unsatisfied constraints', () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle());
    expect(registry.install(makeBundle({ id: 'dependent.plugin', dependencies: { 'fixture.plugin': '^1.0.0' }, ...MINIMAL })).state).toBe('installed');
    expectError(
      () => registry.install(makeBundle({ id: 'dependent2.plugin', dependencies: { 'fixture.plugin': '^2.0.0' }, ...MINIMAL })),
      PluginErrorCode.dependencyUnsatisfied,
    );
  });

  it('runs the install hook and emits a state change', () => {
    const calls: string[] = [];
    const { registry, changes } = makeRegistry({ globals: { calls } });
    registry.install(
      makeBundle({}, { hooks: { install: 'function () { calls.push("install"); }' } }),
    );
    expect(calls).toEqual(['install']);
    expect(changes).toEqual([{ pluginId: 'fixture.plugin', state: 'installed', previous: 'installed' }]);
  });

  it('logs a failing install hook without rejecting install', async () => {
    const warnings: string[] = [];
    const { registry } = makeRegistry({ logger: { warn: (m) => warnings.push(m) } });
    registry.install(makeBundle({}, { hooks: { install: 'function () { throw new Error("hook boom"); }' } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warnings.some((message) => message.includes('install hook failed'))).toBe(true);
  });
});

describe('queries', () => {
  it('get/require/list/isEnabled', () => {
    const { registry } = makeRegistry();
    expect(registry.get('fixture.plugin')).toBeUndefined();
    expectError(() => registry.require('fixture.plugin'), PluginErrorCode.notFound);
    expect(registry.list()).toEqual([]);
    expect(registry.isEnabled('fixture.plugin')).toBe(false);

    registry.install(makeBundle());
    expect(registry.get('fixture.plugin')?.id).toBe('fixture.plugin');
    expect(registry.require('fixture.plugin').version).toBe('1.0.0');
    expect(registry.list()).toHaveLength(1);
    expect(registry.list({ state: 'enabled' })).toEqual([]);
    expect(registry.isEnabled('fixture.plugin')).toBe(false);

    registry.enable('fixture.plugin');
    expect(registry.list({ state: 'enabled' })).toHaveLength(1);
    expect(registry.isEnabled('fixture.plugin')).toBe(true);
  });
});

describe('lifecycle', () => {
  it('enables from installed', () => {
    const calls: string[] = [];
    const { registry, changes } = makeRegistry({ globals: { calls } });
    registry.install(makeBundle({}, { hooks: { activate: 'function () { calls.push("activate"); }' } }));
    const info = registry.enable('fixture.plugin');
    expect(info.state).toBe('enabled');
    expect(calls).toEqual(['activate']);
    expect(changes.at(-1)).toEqual({ pluginId: 'fixture.plugin', state: 'enabled', previous: 'installed' });
  });

  it('re-enables from disabled', () => {
    const calls: string[] = [];
    const { registry } = makeRegistry({ globals: { calls } });
    registry.install(
      makeBundle({}, { hooks: { activate: 'function () { calls.push("activate"); }', deactivate: 'function () { calls.push("deactivate"); }' } }),
    );
    registry.enable('fixture.plugin');
    registry.disable('fixture.plugin');
    registry.enable('fixture.plugin');
    expect(calls).toEqual(['activate', 'deactivate', 'activate']);
  });

  it('rejects invalid state transitions', () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle());
    expectError(() => registry.disable('fixture.plugin'), PluginErrorCode.stateConflict);
    expectError(() => registry.enable('missing'), PluginErrorCode.notFound);
    registry.enable('fixture.plugin');
    expectError(() => registry.enable('fixture.plugin'), PluginErrorCode.stateConflict);
    registry.disable('fixture.plugin');
    expectError(() => registry.disable('fixture.plugin'), PluginErrorCode.stateConflict);
  });

  it('uninstalls and removes the plugin', () => {
    const calls: string[] = [];
    const { registry, changes } = makeRegistry({ globals: { calls } });
    registry.install(
      makeBundle(
        {},
        { hooks: { deactivate: 'function () { calls.push("deactivate"); }', uninstall: 'function () { calls.push("uninstall"); }' } },
      ),
    );
    registry.enable('fixture.plugin');
    const removed = registry.uninstall('fixture.plugin');
    expect(removed.state).toBe('uninstalled');
    expect(calls).toEqual(['deactivate', 'uninstall']);
    expect(registry.get('fixture.plugin')).toBeUndefined();
    expectError(() => registry.require('fixture.plugin'), PluginErrorCode.notFound);
    expect(changes.at(-1)).toEqual({ pluginId: 'fixture.plugin', state: 'uninstalled', previous: 'enabled' });
  });

  it('uninstalls without deactivating an installed plugin', () => {
    const calls: string[] = [];
    const { registry } = makeRegistry({ globals: { calls } });
    registry.install(makeBundle({}, { hooks: { uninstall: 'function () { calls.push("uninstall"); }' } }));
    registry.uninstall('fixture.plugin');
    expect(calls).toEqual(['uninstall']);
  });

  it('uninstalling an unknown plugin throws notFound', () => {
    const { registry } = makeRegistry();
    expectError(() => registry.uninstall('nope'), PluginErrorCode.notFound);
  });

  it('updates to a newer version and preserves state', () => {
    const calls: string[] = [];
    const { registry } = makeRegistry({ globals: { calls } });
    registry.install(makeBundle());
    registry.enable('fixture.plugin');
    const updated = registry.update(
      'fixture.plugin',
      makeBundle({ version: '1.1.0' }, { hooks: { update: 'function () { calls.push("update"); }' } }),
    );
    expect(updated.version).toBe('1.1.0');
    expect(updated.state).toBe('enabled');
    expect(calls).toEqual(['update']);
    expect(registry.isEnabled('fixture.plugin')).toBe(true);
  });

  it('rejects downgrades and id mismatches on update', () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle());
    expectError(() => registry.update('fixture.plugin', makeBundle({ version: '0.9.0' })), PluginErrorCode.conflict);
    expectError(() => registry.update('fixture.plugin', makeBundle({ id: 'other.plugin' })), PluginErrorCode.conflict);
    expectError(() => registry.update('missing', makeBundle()), PluginErrorCode.notFound);
  });

  it('rejects an update that fails engine checks', () => {
    const { registry } = makeRegistry({ sdkVersion: '0.2.0' });
    registry.install(makeBundle({ engines: {} }));
    expectError(() => registry.update('fixture.plugin', makeBundle({ engines: { pluginSdk: '^0.3.0' } })), PluginErrorCode.engineUnsatisfied);
  });
});

describe('contributions', () => {
  it('lists contributions and event wiring', () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle());
    expect(registry.contributionsOf('analyzers')).toEqual([]);
    registry.enable('fixture.plugin');
    expect(registry.contributionsOf('analyzers').map((c) => c.id)).toEqual(['runAnalyzer']);
    expect(registry.contributionsOf('tools').map((c) => c.id)).toEqual(['runTool']);
    expect(registry.eventTypes()).toEqual(['page.published']);
    expect(registry.subscribersForType('page.published')).toEqual(['onPagePublished']);
    expect(registry.subscribersForType('unknown.event')).toEqual([]);
  });

  it('runs an enabled analyzer and validates its output', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle({}, { analyzers: { runAnalyzer: 'function (context) { return { score: context.storeId === "s1" ? 10 : 0, issues: [], recommendations: [] }; }' } }));
    registry.enable('fixture.plugin');
    const output = await registry.runAnalyzer('runAnalyzer', { storeId: 's1' });
    expect(output.score).toBe(10);
  });

  it('rejects invalid analyzer output', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle({}, { analyzers: { runAnalyzer: 'function () { return 42; }' } }));
    registry.enable('fixture.plugin');
    await expectReject(registry.runAnalyzer('runAnalyzer', {}), PluginErrorCode.invalidOutput);
  });

  it('rejects dispatch to unknown or disabled contributions', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle());
    await expectReject(registry.runAnalyzer('runAnalyzer', {}), PluginErrorCode.notFound);
    await expectReject(registry.runAnalyzer('missing', {}), PluginErrorCode.notFound);
  });

  it('executes tools and passes arguments', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle());
    registry.enable('fixture.plugin');
    const result = await registry.executeTool('runTool', { page: 'home' });
    expect(result).toEqual({ ok: true, args: { page: 'home' } });
  });

  it('rejects a contribution when the effective permission was revoked', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle());
    registry.enable('fixture.plugin');
    const records = (registry as unknown as { records: Map<string, { granted: Set<string> }> }).records;
    records.get('fixture.plugin')?.granted.delete('plugin.tools.execute');
    await expectReject(registry.executeTool('runTool', { page: 'home' }), PluginErrorCode.permissionNotGranted);
  });

  it('connects and calls integrations', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle());
    registry.enable('fixture.plugin');
    const connected = await registry.connectIntegration('shopify', { store: 'x' });
    expect(connected).toEqual({ connected: true, config: { store: 'x' } });
    const called = await registry.callIntegration('shopify', 'sync', { limit: 5 });
    expect(called).toEqual({ operation: 'sync', args: { limit: 5 } });
  });

  it('rejects an integration without connect/call', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle({}, { integrations: { shopify: '({})' } }));
    registry.enable('fixture.plugin');
    await expectReject(registry.connectIntegration('shopify', {}), PluginErrorCode.invalidOutput);
    await expectReject(registry.callIntegration('shopify', 'op', {}), PluginErrorCode.invalidOutput);
  });

  it('generates string and object reports', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle({}, { reportGenerators: { monthlyReport: 'function (input) { return "report:" + String(input.periodDays); }' } }));
    registry.enable('fixture.plugin');
    await expect(registry.generateReport('monthlyReport', { periodDays: 30 })).resolves.toBe('report:30');
  });

  it('generates object reports and rejects invalid output', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle());
    registry.enable('fixture.plugin');
    const report = await registry.generateReport('monthlyReport', { periodDays: 30 });
    expect(report).toEqual({ summary: '30', sections: [] });
  });

  it('rejects invalid report output', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle({}, { reportGenerators: { monthlyReport: 'function () { return 42; }' } }));
    registry.enable('fixture.plugin');
    await expectReject(registry.generateReport('monthlyReport', { periodDays: 1 }), PluginErrorCode.invalidOutput);
  });

  it('handles events for a single subscriber', async () => {
    const calls: string[] = [];
    const { registry } = makeRegistry({ globals: { calls } });
    registry.install(
      makeBundle({}, { eventSubscribers: { onPagePublished: 'function (event) { calls.push(event.type + ":" + event.payload.slug); }' } }),
    );
    registry.enable('fixture.plugin');
    await registry.handleEvent('onPagePublished', { type: 'page.published', payload: { slug: 'home' } });
    expect(calls).toEqual(['page.published:home']);
  });

  it('dispatches events to every enabled subscriber and contains failures', async () => {
    const calls: string[] = [];
    const warnings: string[] = [];
    const { registry } = makeRegistry({ globals: { calls }, logger: { warn: (m) => warnings.push(m) } });
    registry.install(
      makeBundle(
        {
          contributions: {
            eventSubscribers: [
              { id: 'onPagePublished', name: 'L', events: ['page.published'] },
              { id: 'secondSubscriber', name: 'L2', events: ['page.published'] },
            ],
          },
        },
        {
          eventSubscribers: {
            onPagePublished: 'function () { throw new Error("subscriber boom"); }',
            secondSubscriber: 'function (event) { calls.push(event.type); }',
          },
        },
      ),
    );
    registry.install(
      makeBundle(
        { id: 'second.plugin', contributions: { eventSubscribers: [{ id: 'onPagePublished', name: 'L', events: ['page.published'] }] } },
        { eventSubscribers: { onPagePublished: 'function (event) { calls.push(event.type); }' } },
      ),
    );
    registry.enable('fixture.plugin');
    registry.enable('second.plugin');
    await registry.dispatchEvent('page.published', { type: 'page.published' });
    await registry.dispatchEvent('unknown.type', { type: 'unknown.type' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toContain('page.published');
    expect(warnings.some((m) => m.includes('subscriber boom'))).toBe(true);
  });

  it('executes actions and validates the ok flag', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle());
    registry.enable('fixture.plugin');
    const result = await registry.executeAction('publish', { action: 'publish', payload: { value: 7 } });
    expect(result).toEqual({ ok: true, output: { value: 7 } });
  });

  it('rejects invalid action output', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle({}, { executionActions: { publish: 'function () { return { output: 1 }; }' } }));
    registry.enable('fixture.plugin');
    await expectReject(registry.executeAction('publish', { action: 'publish' }), PluginErrorCode.invalidOutput);
  });

  it('renders ui extensions', async () => {
    const { registry } = makeRegistry();
    registry.install(makeBundle());
    registry.enable('fixture.plugin');
    const output = await registry.renderUiExtension('dashboardPanel', {});
    expect(output).toEqual({ html: '<div></div>' });
  });
});

describe('dispose', () => {
  it('deactivates enabled plugins and clears the registry', () => {
    const calls: string[] = [];
    const { registry } = makeRegistry({ globals: { calls } });
    registry.install(
      makeBundle({}, { hooks: { deactivate: 'function () { calls.push("deactivate"); }' } }),
    );
    registry.enable('fixture.plugin');
    registry.dispose();
    expect(calls).toEqual(['deactivate']);
    expect(registry.get('fixture.plugin')).toBeUndefined();
    expect(registry.list()).toEqual([]);
  });

  it('disposes an empty registry safely', () => {
    const { registry } = makeRegistry();
    registry.dispose();
    expect(registry.list()).toEqual([]);
  });
});

describe('misc', () => {
  it('uses the provided now() function', () => {
    const { registry } = makeRegistry({ now: () => '2026-05-05T00:00:00.000Z' });
    const info = registry.install(makeBundle());
    expect(info.installedAt).toBe('2026-05-05T00:00:00.000Z');
  });

  it('re-exports approvePermissions', async () => {
    const { approvePermissions } = await import('../src/registry.js');
    expect(approvePermissions(['plugin.analyzers.run'], ['plugin.analyzers.run'])).toEqual(['plugin.analyzers.run']);
  });
});

import { describe, expect, it } from 'vitest';
import { type PluginError, PluginErrorCode } from '../src/errors.js';
import { formatEvent, isHookName, loadPlugin, requiredPermission } from '../src/runtime.js';
import { createSandbox } from '../src/sandbox.js';
import type { PluginBundle } from '../src/types.js';
import { makeBundle, pluginCode, type Fixture } from '../tests/bundle.js';

function load(bundle: PluginBundle): ReturnType<typeof loadPlugin> {
  return loadPlugin(bundle, createSandbox());
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`expected ${code}`);
  } catch (error) {
    const pluginError = error as PluginError;
    expect(pluginError.code).toBe(code);
  }
}

describe('loadPlugin', () => {
  it('resolves a full bundle', () => {
    const loaded = load(makeBundle());
    expect(loaded.manifest.id).toBe('fixture.plugin');
    expect(typeof loaded.hooks.install).toBe('function');
    expect(typeof loaded.hooks.activate).toBe('function');
    expect(typeof loaded.hooks.deactivate).toBe('function');
    expect(typeof loaded.hooks.uninstall).toBe('function');
    expect(typeof loaded.hooks.update).toBe('function');
    expect(loaded.contributions.analyzers).toHaveLength(1);
    expect(loaded.contributions.analyzers[0]?.kind).toBe('analyzers');
    expect(loaded.contributions.tools).toHaveLength(1);
    expect(loaded.contributions.integrations).toHaveLength(1);
    expect(loaded.contributions.reportGenerators).toHaveLength(1);
    expect(loaded.contributions.eventSubscribers).toHaveLength(1);
    expect(loaded.contributions.executionActions).toHaveLength(1);
    expect(loaded.contributions.uiExtensions).toHaveLength(1);
  });

  it('keeps empty kinds empty', () => {
    const bundle = makeBundle({ contributions: {} }, {});
    const loaded = load(bundle);
    expect(loaded.contributions.analyzers).toEqual([]);
  });

  it('rejects code that does not evaluate to an object', () => {
    expectCode(() => load({ manifest: makeBundle().manifest, code: '42' }), PluginErrorCode.invalidCode);
    expectCode(() => load({ manifest: makeBundle().manifest, code: '(function () { return "str"; })()' }), PluginErrorCode.invalidCode);
    expectCode(() => load({ manifest: makeBundle().manifest, code: '[]' }), PluginErrorCode.invalidCode);
  });

  it('rejects a missing implementation for a declared contribution', () => {
    const fixture: Fixture = { analyzers: {} };
    expectCode(() => load(makeBundle({}, fixture)), PluginErrorCode.missingImplementation);
  });

  it('rejects a non-function implementation for a function contribution', () => {
    const fixture: Fixture = { tools: { runTool: '42' } };
    expectCode(() => load(makeBundle({}, fixture)), PluginErrorCode.missingImplementation);
  });

  it('rejects a non-object implementation for an integration', () => {
    const fixture: Fixture = { integrations: { shopify: '5' } };
    expectCode(() => load(makeBundle({}, fixture)), PluginErrorCode.missingImplementation);
  });

  it('rejects a hook that references a missing function', () => {
    const manifest = makeBundle().manifest;
    const bundle: PluginBundle = { manifest: { ...manifest, hooks: { install: 'notThere' } }, code: pluginCode({}) };
    expectCode(() => load(bundle), PluginErrorCode.missingImplementation);
  });

  it('rejects implementations for contributions that were never declared', () => {
    const bundle: PluginBundle = {
      manifest: makeBundle({ contributions: { tools: [{ id: 'runTool', name: 'T' }] }, hooks: {} }).manifest,
      code: pluginCode({ tools: { runTool: 'function (a) { return a; }', ghost: 'function () {}' } }),
    };
    expectCode(() => load(bundle), PluginErrorCode.invalidCode);
  });

  it('resolves only hooks declared in the manifest', () => {
    const bundle: PluginBundle = {
      manifest: {
        schemaVersion: 1,
        id: 'fixture.plugin',
        name: 'Fixture Plugin',
        version: '1.0.0',
        permissions: ['plugin.analyzers.run'],
        hooks: { install: 'onInstall' },
        contributions: {},
      },
      code: pluginCode({ hooks: { onInstall: 'function () {}' } }),
    };
    const loaded = load(bundle);
    expect(typeof loaded.hooks.install).toBe('function');
    expect(loaded.hooks.activate).toBeUndefined();
  });
});

describe('requiredPermission', () => {
  it('uses the default permission for a kind', () => {
    const loaded = load(makeBundle());
    expect(requiredPermission(loaded.contributions.analyzers[0] as never)).toBe('plugin.analyzers.run');
    expect(requiredPermission(loaded.contributions.tools[0] as never)).toBe('plugin.tools.execute');
    expect(requiredPermission(loaded.contributions.eventSubscribers[0] as never)).toBe('plugin.events.subscribe');
  });

  it('honours an explicit permission override', () => {
    const loaded = load(
      makeBundle({
        permissions: ['plugin.analyzers.run', 'plugin.tools.execute'],
        contributions: { analyzers: [{ id: 'runAnalyzer', name: 'A', permission: 'plugin.tools.execute' }] },
      }),
    );
    expect(requiredPermission(loaded.contributions.analyzers[0] as never)).toBe('plugin.tools.execute');
  });
});

describe('isHookName', () => {
  it('recognizes lifecycle hook names', () => {
    expect(isHookName('install')).toBe(true);
    expect(isHookName('activate')).toBe(true);
    expect(isHookName('deactivate')).toBe(true);
    expect(isHookName('uninstall')).toBe(true);
    expect(isHookName('update')).toBe(true);
    expect(isHookName('nope')).toBe(false);
  });
});

describe('formatEvent', () => {
  it('preserves known fields and drops nothing', () => {
    const event = { type: 'page.published', aggregateType: 'page', aggregateId: '42', payload: { slug: 'x' } };
    expect(formatEvent(event)).toEqual(event);
  });

  it('handles a minimal event', () => {
    expect(formatEvent({ type: 'page.published' })).toEqual({ type: 'page.published' });
  });

  it('omits absent optional fields', () => {
    expect(formatEvent({ type: 'x', aggregateType: undefined, aggregateId: undefined, payload: undefined })).toEqual({ type: 'x' });
  });
});

import { describe, expect, it } from 'vitest';
import { PluginError, PluginErrorCode } from '../src/errors.js';
import { validateContributionDeclaration, validateManifest } from '../src/manifest.js';
import { CONTRIBUTION_KINDS, type ContributionKind } from '../src/permissions.js';

function expectManifestError(fn: () => unknown, messagePart: string): void {
  try {
    fn();
    expect.unreachable('expected a PluginError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(PluginError);
    const pluginError = error as PluginError;
    expect(pluginError.code).toBe(PluginErrorCode.invalidManifest);
    expect(pluginError.message).toContain(messagePart);
  }
}

function minimalManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'acme.plugin',
    name: 'Acme Plugin',
    version: '1.2.3',
    permissions: ['plugin.analyzers.run'],
    contributions: {},
    ...overrides,
  };
}

describe('validateManifest', () => {
  it('validates a minimal manifest', () => {
    const manifest = validateManifest(minimalManifest());
    expect(manifest.id).toBe('acme.plugin');
    expect(manifest.name).toBe('Acme Plugin');
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.permissions).toEqual(['plugin.analyzers.run']);
    expect(manifest.engines).toBeUndefined();
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.hooks).toBeUndefined();
    for (const kind of CONTRIBUTION_KINDS) {
      expect(manifest.contributions[kind]).toEqual([]);
    }
  });

  it('validates a full manifest', () => {
    const manifest = validateManifest(
      minimalManifest({
        description: 'Does things.',
        author: 'Acme',
        permissions: [
          'plugin.analyzers.run',
          'plugin.tools.execute',
          'plugin.integrations.use',
          'plugin.reports.generate',
          'plugin.events.subscribe',
          'plugin.execution.actions',
          'plugin.ui.extensions',
        ],
        engines: { pluginSdk: '^0.3.0', api: '>=1.0.0' },
        dependencies: { 'fixture.plugin': '^1.0.0' },
        hooks: { install: 'onInstall' },
        contributions: {
          analyzers: [{ id: 'runAnalyzer', name: 'Analyzer', permission: 'plugin.analyzers.run', parameters: { threshold: 1 } }],
          tools: [{ id: 'runTool', name: 'Tool' }],
          integrations: [{ id: 'shopify', name: 'Shopify', endpoints: ['admin'] }],
          reportGenerators: [{ id: 'monthly', name: 'Monthly', kind: 'monthly' }],
          eventSubscribers: [{ id: 'listener', name: 'Listener', events: ['page.published'] }],
          executionActions: [{ id: 'publish', name: 'Publish' }],
          uiExtensions: [{ id: 'panel', name: 'Panel', extensionPoint: 'dashboard.panel', title: 'Panel', type: 'panel' }],
        },
      }),
    );
    expect(manifest.description).toBe('Does things.');
    expect(manifest.author).toBe('Acme');
    expect(manifest.engines).toEqual({ pluginSdk: '^0.3.0', api: '>=1.0.0' });
    expect(manifest.dependencies).toEqual({ 'fixture.plugin': '^1.0.0' });
    expect(manifest.hooks).toEqual({ install: 'onInstall' });
    expect(manifest.contributions.analyzers).toHaveLength(1);
    expect(manifest.contributions.tools?.[0]?.name).toBe('Tool');
  });

  it('omits empty optional collections', () => {
    const manifest = validateManifest(minimalManifest({ dependencies: {}, engines: {} }));
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.engines).toBeUndefined();
  });

  it('rejects a non-object manifest', () => {
    expectManifestError(() => validateManifest(null), 'must be an object');
    expectManifestError(() => validateManifest([]), 'must be an object');
  });

  it('rejects an unsupported schemaVersion', () => {
    expectManifestError(() => validateManifest(minimalManifest({ schemaVersion: 2 })), 'schemaVersion');
    expectManifestError(() => validateManifest(minimalManifest({ schemaVersion: '1' })), 'schemaVersion');
    expectManifestError(() => validateManifest(minimalManifest({ schemaVersion: undefined })), 'schemaVersion');
  });

  it('rejects a missing or invalid id', () => {
    expectManifestError(() => validateManifest(minimalManifest({ id: '' })), 'id');
    expectManifestError(() => validateManifest(minimalManifest({ id: 'bad id!' })), 'id');
    expectManifestError(() => validateManifest(minimalManifest({ id: undefined })), 'id');
  });

  it('rejects a missing or empty name', () => {
    expectManifestError(() => validateManifest(minimalManifest({ name: '  ' })), 'name');
    expectManifestError(() => validateManifest(minimalManifest({ name: 42 })), 'name');
  });

  it('rejects an invalid version', () => {
    try {
      validateManifest(minimalManifest({ version: 'abc' }));
      expect.unreachable('expected invalidVersion');
    } catch (error) {
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.invalidVersion);
    }
  });

  it('rejects missing, empty or unknown permissions', () => {
    expectManifestError(() => validateManifest(minimalManifest({ permissions: [] })), 'at least one permission');
    expectManifestError(() => validateManifest(minimalManifest({ permissions: undefined })), 'at least one permission');
    expectManifestError(() => validateManifest(minimalManifest({ permissions: 'plugin.analyzers.run' })), 'at least one permission');
    expectManifestError(() => validateManifest(minimalManifest({ permissions: ['plugin.nope.run'] })), 'unknown permission');
    expectManifestError(() => validateManifest(minimalManifest({ permissions: [123] })), 'unknown permission');
  });

  it('validates engines', () => {
    expectManifestError(() => validateManifest(minimalManifest({ engines: { pluginSdk: 'bogus' } })), 'pluginSdk engine');
    expectManifestError(() => validateManifest(minimalManifest({ engines: { api: '1.0.0' } })), 'api engine');
    const withEngine = validateManifest(minimalManifest({ engines: { pluginSdk: '1.0.0' } }));
    expect(withEngine.engines).toEqual({ pluginSdk: '1.0.0' });
  });

  it('normalizes dependencies', () => {
    const manifest = validateManifest(minimalManifest({ dependencies: { a: '^1.0.0', b: 42, c: '' } }));
    expect(manifest.dependencies).toEqual({ a: '^1.0.0' });
    expect(validateManifest(minimalManifest({ dependencies: 'not-an-object' })).dependencies).toBeUndefined();
  });

  it('validates hooks', () => {
    expectManifestError(() => validateManifest(minimalManifest({ hooks: { nope: 'fn' } })), 'unknown hook');
    expectManifestError(() => validateManifest(minimalManifest({ hooks: { install: 42 } })), 'reference a function id');
    expectManifestError(() => validateManifest(minimalManifest({ hooks: { install: '' } })), 'reference a function id');
    const manifest = validateManifest(minimalManifest({ hooks: { install: 'onInstall', update: 'onUpdate' } }));
    expect(manifest.hooks).toEqual({ install: 'onInstall', update: 'onUpdate' });
  });

  it('requires contributions to be an object', () => {
    expectManifestError(() => validateManifest(minimalManifest({ contributions: null })), 'contributions');
    expectManifestError(() => validateManifest(minimalManifest({ contributions: [] })), 'contributions');
  });

  it('rejects a non-array contribution list', () => {
    expectManifestError(() => validateManifest(minimalManifest({ contributions: { analyzers: {} } })), 'must be an array');
  });

  it('rejects duplicate contribution ids within a kind', () => {
    expectManifestError(
      () =>
        validateManifest(
          minimalManifest({ contributions: { analyzers: [{ id: 'run', name: 'A' }, { id: 'run', name: 'B' }] } }),
        ),
      'Duplicate contribution id',
    );
  });

  it('allows the same id across different kinds', () => {
    const manifest = validateManifest(
      minimalManifest({
        permissions: ['plugin.analyzers.run', 'plugin.tools.execute'],
        contributions: { analyzers: [{ id: 'run', name: 'A' }], tools: [{ id: 'run', name: 'B' }] },
      }),
    );
    expect(manifest.contributions.analyzers?.[0]?.id).toBe('run');
    expect(manifest.contributions.tools?.[0]?.id).toBe('run');
  });

  it('rejects contributions whose required permission was not requested', () => {
    expectManifestError(
      () => validateManifest(minimalManifest({ contributions: { tools: [{ id: 'run', name: 'T' }] } })),
      'not requested in the manifest',
    );
    expectManifestError(
      () =>
        validateManifest(
          minimalManifest({
            permissions: ['plugin.tools.execute'],
            contributions: { analyzers: [{ id: 'run', name: 'A', permission: 'plugin.events.subscribe' }] },
          }),
        ),
      'not requested in the manifest',
    );
  });
});

describe('validateContributionDeclaration', () => {
  const expectKindError = (kind: ContributionKind, raw: unknown, messagePart: string): void => {
    expectManifestError(() => validateContributionDeclaration(kind, raw), messagePart);
  };

  it('normalizes a valid analyzer', () => {
    const declaration = validateContributionDeclaration('analyzers', { id: 'a1', name: 'A' });
    expect(declaration).toEqual({ id: 'a1', name: 'A' });
  });

  it('rejects an invalid analyzer id', () => {
    expectKindError('analyzers', { id: 'a b' }, 'invalid');
    expectKindError('analyzers', {}, 'id');
    expectKindError('analyzers', 42, 'must be an object');
  });

  it('rejects an unknown declared permission', () => {
    expectKindError('analyzers', { id: 'a1', permission: 'plugin.nope.run' }, 'unknown permission');
  });

  it('normalizes tool parameters', () => {
    expect(validateContributionDeclaration('tools', { id: 't1', parameters: { x: 1 } }).parameters).toEqual({ x: 1 });
    expect(validateContributionDeclaration('tools', { id: 't1', parameters: 'nope' }).parameters).toBeUndefined();
  });

  it('normalizes integration endpoints', () => {
    expect(validateContributionDeclaration('integrations', { id: 'i1', endpoints: ['admin', 42] }).endpoints).toEqual(['admin', '42']);
    expect(validateContributionDeclaration('integrations', { id: 'i1' }).endpoints).toBeUndefined();
  });

  it('requires a report generator kind', () => {
    expect(validateContributionDeclaration('reportGenerators', { id: 'r1', kind: 'monthly' }).kind).toBe('monthly');
    expectKindError('reportGenerators', { id: 'r1' }, 'kind');
    expectKindError('reportGenerators', { id: 'r1', kind: ' ' }, 'kind');
  });

  it('requires valid event subscriber events', () => {
    const declaration = validateContributionDeclaration('eventSubscribers', { id: 'e1', events: ['page.published', 'order.created'] });
    expect(declaration.events).toEqual(['page.published', 'order.created']);
    expectKindError('eventSubscribers', { id: 'e1' }, 'at least one event');
    expectKindError('eventSubscribers', { id: 'e1', events: [] }, 'at least one event');
    expectKindError('eventSubscribers', { id: 'e1', events: ['Page.Published'] }, 'invalid event type');
    expectKindError('eventSubscribers', { id: 'e1', events: ['page.published', 'order'] }, 'invalid event type');
  });

  it('requires a valid ui extension point', () => {
    const declaration = validateContributionDeclaration('uiExtensions', {
      id: 'u1',
      extensionPoint: 'dashboard.panel',
      title: 'Panel',
      type: 'panel',
    });
    expect(declaration.extensionPoint).toBe('dashboard.panel');
    expect(declaration.title).toBe('Panel');
    expect(declaration.type).toBe('panel');
    expectKindError('uiExtensions', { id: 'u1' }, 'extensionPoint');
    expectKindError('uiExtensions', { id: 'u1', extensionPoint: 'NO UPPER' }, 'extension point');
  });
});

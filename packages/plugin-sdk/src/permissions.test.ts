import { describe, expect, it } from 'vitest';
import { PluginError, PluginErrorCode } from '../src/errors.js';
import {
  ALL_PLUGIN_PERMISSIONS,
  approvePermissions,
  CONTRIBUTION_KINDS,
  defaultPermissionFor,
  isPluginPermission,
  permissionFor,
  PluginPermissions,
  requireGranted,
  type ContributionKind,
} from '../src/permissions.js';

describe('permission constants', () => {
  it('exposes the seven plugin permissions', () => {
    expect(PluginPermissions.analyzers).toBe('plugin.analyzers.run');
    expect(PluginPermissions.tools).toBe('plugin.tools.execute');
    expect(PluginPermissions.integrations).toBe('plugin.integrations.use');
    expect(PluginPermissions.reports).toBe('plugin.reports.generate');
    expect(PluginPermissions.events).toBe('plugin.events.subscribe');
    expect(PluginPermissions.actions).toBe('plugin.execution.actions');
    expect(PluginPermissions.ui).toBe('plugin.ui.extensions');
  });

  it('collects every permission and kind', () => {
    expect(ALL_PLUGIN_PERMISSIONS).toHaveLength(7);
    expect(CONTRIBUTION_KINDS).toEqual([
      'analyzers',
      'tools',
      'integrations',
      'reportGenerators',
      'eventSubscribers',
      'executionActions',
      'uiExtensions',
    ]);
  });
});

describe('defaultPermissionFor', () => {
  it('maps each contribution kind to its permission', () => {
    const cases: Array<[ContributionKind, string]> = [
      ['analyzers', 'plugin.analyzers.run'],
      ['tools', 'plugin.tools.execute'],
      ['integrations', 'plugin.integrations.use'],
      ['reportGenerators', 'plugin.reports.generate'],
      ['eventSubscribers', 'plugin.events.subscribe'],
      ['executionActions', 'plugin.execution.actions'],
      ['uiExtensions', 'plugin.ui.extensions'],
    ];
    for (const [kind, permission] of cases) {
      expect(defaultPermissionFor(kind)).toBe(permission);
    }
  });
});

describe('permissionFor', () => {
  it('uses the declared override when present', () => {
    expect(permissionFor('tools', 'plugin.events.subscribe')).toBe('plugin.events.subscribe');
  });

  it('falls back to the default permission', () => {
    expect(permissionFor('tools')).toBe('plugin.tools.execute');
    expect(permissionFor('analyzers', undefined)).toBe('plugin.analyzers.run');
  });
});

describe('isPluginPermission', () => {
  it('recognizes known permissions', () => {
    expect(isPluginPermission('plugin.analyzers.run')).toBe(true);
    expect(isPluginPermission('plugin.ui.extensions')).toBe(true);
  });

  it('rejects unknown permissions', () => {
    expect(isPluginPermission('plugin.really.big')).toBe(false);
    expect(isPluginPermission('')).toBe(false);
  });
});

describe('approvePermissions', () => {
  it('intersects and preserves requested order', () => {
    const approved = approvePermissions(
      ['plugin.analyzers.run', 'plugin.tools.execute', 'plugin.reports.generate'],
      ['plugin.reports.generate', 'plugin.analyzers.run'],
    );
    expect(approved).toEqual(['plugin.analyzers.run', 'plugin.reports.generate']);
  });

  it('deduplicates requested permissions', () => {
    const approved = approvePermissions(['plugin.analyzers.run', 'plugin.analyzers.run'], ALL_PLUGIN_PERMISSIONS);
    expect(approved).toEqual(['plugin.analyzers.run']);
  });

  it('returns empty when nothing is allowed', () => {
    expect(approvePermissions(['plugin.analyzers.run'], [])).toEqual([]);
  });

  it('returns empty when nothing is requested', () => {
    expect(approvePermissions([], ALL_PLUGIN_PERMISSIONS)).toEqual([]);
  });
});

describe('requireGranted', () => {
  it('returns the deduplicated granted list when fully approved', () => {
    expect(requireGranted(['plugin.analyzers.run', 'plugin.analyzers.run'], ['plugin.analyzers.run'])).toEqual([
      'plugin.analyzers.run',
    ]);
  });

  it('throws with the first ungranted permission', () => {
    expect(() => requireGranted(['plugin.analyzers.run', 'plugin.tools.execute'], ['plugin.analyzers.run'])).toThrow(PluginError);
    try {
      requireGranted(['plugin.analyzers.run', 'plugin.tools.execute'], ['plugin.analyzers.run']);
    } catch (error) {
      expect(error).toBeInstanceOf(PluginError);
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.permissionNotGranted);
      expect(pluginError.context.granted).toEqual(['plugin.analyzers.run']);
    }
  });
});

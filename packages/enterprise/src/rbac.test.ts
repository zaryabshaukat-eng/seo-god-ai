import { describe, expect, it } from 'vitest';
import { EnterpriseAuthorizationError, EnterpriseValidationError } from './errors.js';
import {
  ALL_PERMISSIONS,
  Permissions,
  ROLE_PERMISSIONS,
  RoleManager,
} from './rbac.js';

describe('permission catalog', () => {
  it('defines the canonical permission set', () => {
    expect(ALL_PERMISSIONS).toContain(Permissions.tenantRead);
    expect(ALL_PERMISSIONS).toContain(Permissions.billingManage);
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('grants every permission to owners', () => {
    expect(ROLE_PERMISSIONS.owner).toHaveLength(ALL_PERMISSIONS.length);
  });
});

describe('RoleManager', () => {
  it('resolves built-in role permissions', () => {
    const manager = new RoleManager();
    expect(manager.hasPermission('owner', Permissions.billingManage)).toBe(true);
    expect(manager.hasPermission('viewer', Permissions.orgManage)).toBe(false);
    expect(manager.hasPermission('member', Permissions.auditRead)).toBe(true);
    expect(manager.permissionsFor('admin')).toContain(Permissions.apiKeyManage);
  });

  it('recognizes unknown roles as having no permissions', () => {
    const manager = new RoleManager();
    expect(manager.isKnownRole('ghost')).toBe(false);
    expect(manager.permissionsFor('ghost')).toEqual([]);
    expect(manager.hasPermission('ghost', Permissions.tenantRead)).toBe(false);
  });

  it('checks any-of semantics', () => {
    const manager = new RoleManager();
    expect(manager.hasAnyPermission('viewer', [Permissions.orgManage, Permissions.orgRead])).toBe(true);
    expect(manager.hasAnyPermission('viewer', [Permissions.orgManage, Permissions.webhookManage])).toBe(false);
    expect(manager.hasAnyPermission('viewer', [])).toBe(false);
  });

  it('registers and validates custom roles', () => {
    const manager = new RoleManager([{ name: 'seo_analyst', permissions: [Permissions.orgRead, Permissions.teamRead] }]);
    expect(manager.isKnownRole('seo_analyst')).toBe(true);
    expect(manager.hasPermission('seo_analyst', Permissions.orgRead)).toBe(true);
    expect(manager.hasPermission('seo_analyst', Permissions.orgManage)).toBe(false);
  });

  it('rejects overriding built-in roles', () => {
    const manager = new RoleManager();
    expect(() => manager.defineRole({ name: 'admin', permissions: [] })).toThrow(EnterpriseValidationError);
  });

  it('rejects unknown permissions on custom roles', () => {
    const manager = new RoleManager();
    expect(() => manager.defineRole({ name: 'hax', permissions: ['tenant.destroy'] })).toThrow(
      EnterpriseValidationError,
    );
  });

  it('replaces a previously defined custom role', () => {
    const manager = new RoleManager();
    manager.defineRole({ name: 'ops', permissions: [Permissions.orgRead] });
    manager.defineRole({ name: 'ops', permissions: [Permissions.auditRead] });
    expect(manager.hasPermission('ops', Permissions.auditRead)).toBe(true);
    expect(manager.hasPermission('ops', Permissions.orgRead)).toBe(false);
  });

  it('requirePermission throws with context when denied', () => {
    const manager = new RoleManager();
    expect(() =>
      manager.requirePermission('viewer', Permissions.billingRead, { tenantId: 't1', userId: 'u1' }),
    ).toThrow(EnterpriseAuthorizationError);
    expect(() => manager.requirePermission('owner', Permissions.billingRead)).not.toThrow();
  });
});

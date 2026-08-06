import { describe, expect, it, vi } from 'vitest';
import { EnterpriseService } from '@seogod/enterprise';
import { CopilotAuthorizationError } from './errors.js';
import {
  assertAuthorized,
  COPILOT_PERMISSIONS,
  fromEnterprise,
  fromRolePolicy,
} from './permissions.js';

describe('COPILOT_PERMISSIONS', () => {
  it('uses the enterprise permission vocabulary', () => {
    expect(COPILOT_PERMISSIONS.chat).toBe('tenant.read');
    expect(COPILOT_PERMISSIONS.read).toBe('org.read');
    expect(COPILOT_PERMISSIONS.manage).toBe('org.manage');
    expect(COPILOT_PERMISSIONS.audit).toBe('audit.read');
  });
});

describe('fromRolePolicy', () => {
  const authorize = fromRolePolicy([
    { role: 'admin', permissions: ['org.read', 'org.manage'] },
    { role: 'owner', permissions: ['*'] },
    { role: 'viewer', permissions: ['org.read'] },
  ]);

  it('allows roles with the permission', () => {
    expect(() => authorize('admin', 'org.read')).not.toThrow();
    expect(() => authorize('viewer', 'org.read')).not.toThrow();
  });

  it('denies roles without the permission', () => {
    expect(() => authorize('viewer', 'org.manage')).toThrow(CopilotAuthorizationError);
    expect(() => authorize('nobody', 'org.read')).toThrow(CopilotAuthorizationError);
  });

  it('grants every permission to wildcard roles', () => {
    expect(() => authorize('owner', 'audit.read')).not.toThrow();
  });
});

describe('assertAuthorized', () => {
  it('is a no-op when no authorizer is wired', () => {
    expect(() => assertAuthorized(undefined, 'viewer', 'org.read')).not.toThrow();
  });

  it('delegates to the authorizer', () => {
    const authorize = vi.fn();
    assertAuthorized(authorize, 'member', 'org.read', { userId: 'u1', tenantId: 't1' });
    expect(authorize).toHaveBeenCalledWith('member', 'org.read', { userId: 'u1', tenantId: 't1' });
  });
});

describe('fromEnterprise', () => {
  const authorizeFrom = (service: EnterpriseService) =>
    fromEnterprise((role, permission, context) => service.authorize(role, permission, context));

  it('enforces built-in enterprise roles', () => {
    const authorize = authorizeFrom(new EnterpriseService());

    expect(() => authorize('owner', 'org.manage')).not.toThrow();
    expect(() => authorize('viewer', 'org.read')).not.toThrow();

    const denied = () => authorize('viewer', 'org.manage');
    expect(denied).toThrow();
    let err: unknown;
    try {
      denied();
    } catch (error) {
      err = error;
    }
    expect((err as { code?: string }).code).toBe('authorization.denied');
  });

  it('passes the permission context through', () => {
    const authorize = authorizeFrom(new EnterpriseService());
    expect(() => authorize('admin', 'org.read', { tenantId: 't1', userId: 'u1' })).not.toThrow();
  });
});

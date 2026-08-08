/**
 * Unit tests for the API primitives: error model, validation, rate limiting,
 * RBAC permissions, router, request context, notification store, settings
 * store and the auth service.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PluginError, PluginErrorCode } from '@seogod/plugin-sdk';
import { EnterpriseService, type WebhookDeliverer } from '@seogod/enterprise';
import { MetricsRegistry } from '@seogod/monitoring';
import { EnterpriseMetrics } from '@seogod/enterprise';
import {
  ApiError,
  ApiValidationError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  MethodNotAllowedError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  errorBody,
  mapKnownError,
  mapPluginError,
  toApiError,
} from './errors.js';
import {
  optionalArray,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireEmail,
  requireEnum,
  requirePassword,
  requireString,
  validateAll,
} from './validation.js';
import { SlidingWindowRateLimiter, enforceLimit } from './rate-limit.js';
import {
  PlatformPermissions,
  permissionsForRole,
  principalHasPermission,
  requirePlatformPermission,
  roleHasPermission,
} from './permissions.js';
import { Router, compilePath, hasParams, requireRouteMatch, splitPath } from './router.js';
import { createContext, requireParam } from './context.js';
import { NotificationsService } from './notifications.js';
import { SettingsStore } from './settings.js';
import { AuthService, hashPassword, verifyPassword } from './auth.js';

const deliverer: WebhookDeliverer = {
  async deliver() {
    return { status: 200 };
  },
};

function makeEnterprise(): EnterpriseService {
  return new EnterpriseService({
    now: () => '2026-01-15T12:00:00.000Z',
    id: () => `e_${Math.random().toString(36).slice(2, 8)}`,
    webhookDeliverer: deliverer,
    metrics: new EnterpriseMetrics(new MetricsRegistry()),
  });
}

function makeContext() {
  return createContext({
    requestId: 'req-1',
    method: 'GET',
    pathname: '/api/v1/x',
    query: new URLSearchParams(),
    headers: {},
    body: undefined,
    ip: '127.0.0.1',
    logger: { child: () => ({}) } as never,
    res: {} as never,
  });
}

describe('error model', () => {
  it('carries status, code, context and retryable flags', () => {
    const error = new ApiError(418, 'teapot', { code: 'custom', context: { a: 1 }, retryable: true });
    expect(error.status).toBe(418);
    expect(error.code).toBe('custom');
    expect(error.context).toEqual({ a: 1 });
    expect(error.retryable).toBe(true);
  });

  it('defaults codes and retryable per class', () => {
    expect(new BadRequestError('x').code).toBe('bad_request');
    expect(new UnauthorizedError().code).toBe('unauthorized');
    expect(new ForbiddenError().code).toBe('forbidden');
    expect(new NotFoundError().code).toBe('not_found');
    expect(new ConflictError().code).toBe('conflict');
    expect(new MethodNotAllowedError('x').code).toBe('method_not_allowed');
    expect(new ApiValidationError('x').code).toBe('validation_error');
    expect(new RateLimitError('x', 500).code).toBe('rate_limited');
    expect(new RateLimitError('x', 500).retryable).toBe(true);
    expect(new ApiError(500, 'x').retryable).toBe(true);
  });

  it('derives codes from the status when none is provided', () => {
    expect(new ApiError(400, 'x').code).toBe('bad_request');
    expect(new ApiError(401, 'x').code).toBe('unauthorized');
    expect(new ApiError(403, 'x').code).toBe('forbidden');
    expect(new ApiError(404, 'x').code).toBe('not_found');
    expect(new ApiError(409, 'x').code).toBe('conflict');
    expect(new ApiError(429, 'x').code).toBe('rate_limited');
    expect(new ApiError(418, 'x').code).toBe('internal_error');
  });

  it('renders the canonical error body', () => {
    const body = errorBody(new ApiError(500, 'x', { code: 'boom', context: { k: 'v' } }));
    expect(body).toEqual({ error: { code: 'boom', message: 'x', context: { k: 'v' }, retryable: true } });
    expect(errorBody(new NotFoundError('gone'))).toEqual({ error: { code: 'not_found', message: 'gone', retryable: false } });
  });

  it('normalizes any thrown value via toApiError', () => {
    const original = new NotFoundError('gone');
    expect(toApiError(original)).toBe(original);

    const mapped = new Error('gone');
    mapped.name = 'IsolationError';
    expect(toApiError(mapped)).toBeInstanceOf(ForbiddenError);

    const plain = new Error('boom');
    const normalized = toApiError(plain);
    expect(normalized.status).toBe(500);
    expect(normalized.code).toBe('internal_error');

    expect(toApiError('string')).toBeInstanceOf(ApiError);
  });

  it('maps domain errors by name via mapKnownError', () => {
    const named = (name: string) => {
      const error = new Error(`msg for ${name}`);
      error.name = name;
      return error;
    };
    expect(mapKnownError(named('FooAuthorizationError'))?.status).toBe(403);
    expect(mapKnownError(named('SomePermissionIssue'))?.status).toBe(403);
    expect(mapKnownError(named('IsolationError'))?.code).toBe('tenant_isolation');
    expect(mapKnownError(named('NotFoundError'))?.status).toBe(404);
    expect(mapKnownError(named('ConflictError'))?.status).toBe(409);
    expect(mapKnownError(named('ValidationError'))?.status).toBe(400);
    expect(mapKnownError(named('RateLimitError'))?.status).toBe(429);
    expect(mapKnownError(named('SomethingElse'))).toBeNull();

    const contextual = new Error('c');
    (contextual as any).context = { tenant: 't1' };
    contextual.name = 'ValidationError';
    expect((mapKnownError(contextual) as ApiError)?.context).toEqual({ tenant: 't1' });
  });

  it('maps plugin-SDK errors to canonical HTTP responses', () => {
    const pluginError = (code: (typeof PluginErrorCode)[keyof typeof PluginErrorCode], message: string) => new PluginError(code, message, { context: { pluginId: 'x' } });

    expect(mapPluginError(pluginError(PluginErrorCode.notFound, 'gone'))).toBeInstanceOf(NotFoundError);
    expect(mapPluginError(pluginError(PluginErrorCode.notFound, 'gone')).status).toBe(404);
    expect(mapPluginError(pluginError(PluginErrorCode.notFound, 'gone')).code).toBe('plugin_not_found');

    expect(mapPluginError(pluginError(PluginErrorCode.conflict, 'dupe')).status).toBe(409);
    expect(mapPluginError(pluginError(PluginErrorCode.stateConflict, 'wrong state')).status).toBe(409);
    expect(mapPluginError(pluginError(PluginErrorCode.stateConflict, 'wrong state')).code).toBe('plugin_conflict');

    expect(mapPluginError(pluginError(PluginErrorCode.permissionNotGranted, 'nope')).status).toBe(403);
    expect(mapPluginError(pluginError(PluginErrorCode.permissionNotGranted, 'nope')).code).toBe('plugin_permission_denied');
    expect(mapPluginError(pluginError(PluginErrorCode.permissionNotDeclared, 'undeclared')).status).toBe(403);

    expect(mapPluginError(pluginError(PluginErrorCode.sandboxTimeout, 'slow')).status).toBe(400);
    expect(mapPluginError(pluginError(PluginErrorCode.sandboxTimeout, 'slow')).code).toBe('plugin_execution_error');
    expect(mapPluginError(pluginError(PluginErrorCode.sandboxEval, 'boom')).status).toBe(400);

    expect(mapPluginError(pluginError(PluginErrorCode.invalidVersion, 'bad')).status).toBe(400);
    expect(mapPluginError(pluginError(PluginErrorCode.invalidVersion, 'bad')).code).toBe('plugin_error');

    expect(mapPluginError(pluginError(PluginErrorCode.notFound, 'gone')).context).toEqual({ pluginId: 'x' });
  });
});

describe('validation', () => {
  it('requires non-empty strings and trims', () => {
    expect(requireString({ name: '  Ada  ' }, 'name')).toBe('Ada');
    expect(() => requireString({}, 'name', 'Name')).toThrow(ApiValidationError);
    expect(() => requireString({ name: '   ' }, 'name')).toThrow(ApiValidationError);
    expect(() => requireString(null, 'name')).toThrow(ApiValidationError);
  });

  it('validates emails', () => {
    expect(requireEmail({ email: 'a@b.co' })).toBe('a@b.co');
    expect(() => requireEmail({ email: 'nope' })).toThrow(ApiValidationError);
  });

  it('validates passwords by minimum length', () => {
    expect(requirePassword({ password: 'password' })).toBe('password');
    expect(() => requirePassword({ password: 'short' })).toThrow(ApiValidationError);
    expect(() => requirePassword({ password: 'x' }, 'password', 4)).toThrow(ApiValidationError);
  });

  it('reads optional fields', () => {
    expect(optionalString({ a: '  x  ' }, 'a')).toBe('x');
    expect(optionalString({ a: 5 }, 'a')).toBeUndefined();
    expect(optionalString({}, 'a')).toBeUndefined();
    expect(optionalBoolean({ a: true }, 'a')).toBe(true);
    expect(optionalBoolean({ a: 1 }, 'a')).toBeUndefined();
    expect(optionalNumber({ a: 3 }, 'a')).toBe(3);
    expect(optionalNumber({ a: Infinity }, 'a')).toBeUndefined();
    expect(optionalNumber({ a: '3' }, 'a')).toBeUndefined();
    expect(optionalArray({ a: [1, 2] }, 'a')).toEqual([1, 2]);
    expect(optionalArray({ a: 'no' }, 'a')).toEqual([]);
    expect(optionalArray(null, 'a')).toEqual([]);
  });

  it('validates enums', () => {
    expect(requireEnum({ role: 'owner' }, 'role', ['owner', 'viewer'])).toBe('owner');
    expect(() => requireEnum({ role: 'boss' }, 'role', ['owner', 'viewer'])).toThrow(ApiValidationError);
  });

  it('collects errors across validators', () => {
    expect(() =>
      validateAll([
        () => ({ a: 'a is bad' }),
        () => ({ b: 'b is bad' }),
      ]),
    ).toThrow(ApiValidationError);
    expect(() => validateAll([])).not.toThrow();
  });

  it('returns undefined for non-record bodies', () => {
    expect(optionalString('str', 'a')).toBeUndefined();
    expect(optionalBoolean('str', 'a')).toBeUndefined();
    expect(optionalNumber('str', 'a')).toBeUndefined();
    expect(optionalArray('str', 'a')).toEqual([]);
  });
});

describe('rate limiting', () => {
  it('allows within budget and rejects above it', () => {
    let t = 1000;
    const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, max: 2, now: () => t });
    expect(limiter.hit('k').allowed).toBe(true);
    expect(limiter.hit('k').allowed).toBe(true);
    const third = limiter.hit('k');
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.size).toBe(1);

    t += 1001;
    expect(limiter.hit('k').allowed).toBe(true);
  });

  it('enforceLimit throws RateLimitError', () => {
    const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, max: 1 });
    expect(enforceLimit(limiter, 'k').allowed).toBe(true);
    expect(() => enforceLimit(limiter, 'k')).toThrow(RateLimitError);
  });

  it('reset clears state', () => {
    const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, max: 1 });
    limiter.hit('k');
    limiter.reset();
    expect(limiter.size).toBe(0);
    expect(limiter.hit('k').allowed).toBe(true);
  });

  it('applies default window and budget', () => {
    const limiter = new SlidingWindowRateLimiter();
    const decision = limiter.hit('k');
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(99);
    expect(decision.retryAfterMs).toBe(0);
  });
});

describe('permissions', () => {
  it('resolves role permission sets', () => {
    expect(permissionsForRole('owner')).toContain(PlatformPermissions.adminWrite);
    expect(permissionsForRole('viewer')).not.toContain(PlatformPermissions.adminWrite);
    expect(permissionsForRole('unknown-role')).toEqual([]);
    expect(roleHasPermission('member', PlatformPermissions.dashboardRead)).toBe(true);
    expect(roleHasPermission('viewer', PlatformPermissions.crawlWrite)).toBe(false);
  });

  it('checks principals by permission list and falls back to role', () => {
    expect(principalHasPermission({ role: 'viewer', permissions: ['admin.read'] }, PlatformPermissions.adminRead)).toBe(true);
    expect(principalHasPermission({ role: 'viewer', permissions: [] }, PlatformPermissions.adminRead)).toBe(false);
    expect(principalHasPermission({ role: 'owner' }, PlatformPermissions.adminRead)).toBe(true);
  });

  it('throws when principal is missing or unauthorized', () => {
    expect(() => requirePlatformPermission(undefined, PlatformPermissions.adminRead)).toThrow(UnauthorizedError);
    expect(() =>
      requirePlatformPermission({ role: 'viewer', permissions: [] }, PlatformPermissions.adminRead),
    ).toThrow(ForbiddenError);
  });
});

describe('router', () => {
  it('splits and compiles paths', () => {
    expect(splitPath('/api/v1/a/b')).toEqual(['api', 'v1', 'a', 'b']);
    expect(splitPath('')).toEqual([]);
    expect(compilePath('/x/:id')).toEqual(['x', null]);
    expect(hasParams('/x/:id')).toBe(true);
    expect(hasParams('/x/id')).toBe(false);
  });

  it('matches routes with params and methods', async () => {
    const router = new Router();
    const handler = async () => {};
    router.on('GET', '/api/v1/crawls/:id', handler);

    const match = router.match('GET', '/api/v1/crawls/abc%201');
    expect(match?.params).toEqual({ id: 'abc 1' });

    expect(router.match('POST', '/api/v1/crawls/abc')).toBeNull();
    expect(router.match('GET', '/api/v1/crawls/abc/extra')).toBeNull();
    expect(router.pathExists('/api/v1/crawls/anything')).toBe(true);
    expect(router.pathExists('/api/v1/nope')).toBe(false);
    expect(router.methodExists('GET', '/api/v1/crawls/anything')).toBe(true);
    expect(router.methodExists('POST', '/api/v1/crawls/anything')).toBe(false);
    expect(router.routesCount).toBe(1);
    expect(router.list()).toHaveLength(1);
  });

  it('requireRouteMatch throws 404 when unmatched', () => {
    const router = new Router();
    expect(() => requireRouteMatch(router, 'GET', '/x')).toThrow(NotFoundError);
  });
});

describe('context', () => {
  it('creates a shell with params and state', () => {
    const ctx = makeContext();
    expect(ctx.requestId).toBe('req-1');
    expect(ctx.state).toBeInstanceOf(Map);
    expect(ctx.params).toEqual({});
  });

  it('requireParam returns the value or throws', () => {
    const ctx = makeContext();
    ctx.params = { id: '42' };
    expect(requireParam(ctx, 'id')).toBe('42');
    expect(() => requireParam(ctx, 'missing')).toThrow(NotFoundError);
  });
});

describe('notifications service', () => {
  it('creates, lists, marks read and counts', () => {
    let nid = 0;
    const service = new NotificationsService({
      now: () => '2026-01-15T12:00:00.000Z',
      id: () => `n${++nid}`,
    });
    const first = service.create({ tenantId: 't1', type: 'alert', title: 'A', message: 'one', severity: 'warning' });
    service.create({ tenantId: 't1', type: 'alert', title: 'B', message: 'two' });
    service.create({ tenantId: 't2', type: 'alert', title: 'C', message: 'other' });

    expect(service.list('t1')).toHaveLength(2);
    expect(service.unreadCount('t1')).toBe(2);
    expect(first.severity).toBe('warning');

    service.markRead('t1', first.id);
    const marked = service.list('t1').find((entry) => entry.id === first.id);
    expect(marked?.read).toBe(true);

    expect(() => service.markRead('t1', 'missing')).toThrow();
    expect(service.markAllRead('t1')).toBe(1);
    expect(service.unreadCount('t1')).toBe(0);

    service.reset();
    expect(service.list('t1')).toHaveLength(0);
  });

  it('uses the default clock and id generator', () => {
    const service = new NotificationsService();
    const notification = service.create({ tenantId: 't1', type: 'alert', title: 'A', message: 'M' });
    expect(notification.severity).toBe('info');
    expect(notification.id).toEqual(expect.any(String));
    expect(notification.createdAt).toEqual(expect.any(String));
  });
});

describe('settings store', () => {
  it('returns defaults, updates and keeps profiles per user', () => {
    const store = new SettingsStore();
    expect(store.get('t1')).toEqual(expect.objectContaining({ storeName: 'My Store' }));
    expect(store.getProfile('t1', 'u1').locale).toBe('en');

    store.update('t1', { storeName: 'X' });
    expect(store.get('t1').storeName).toBe('X');
    expect(store.get('t2').storeName).toBe('My Store');

    store.updateProfile('t1', 'u1', { theme: 'dark' });
    expect(store.getProfile('t1', 'u1').theme).toBe('dark');
    expect(store.getProfile('t1', 'u2').theme).toBe('system');

    store.reset();
    expect(store.get('t1').storeName).toBe('My Store');
  });
});

describe('auth service', () => {
  let t: number;
  let uid: number;
  let auth: AuthService;
  let enterprise: EnterpriseService;

  beforeEach(() => {
    t = 1_700_000_000_000;
    uid = 0;
    enterprise = makeEnterprise();
    auth = new AuthService(enterprise, {
      now: () => t,
      id: () => `u${++uid}`,
      accessTokenTtlMs: 1000,
      refreshTokenTtlMs: 5000,
    });
  });

  it('registers, logs in and validates credentials', async () => {
    const session = await auth.register({ name: 'Ada', email: 'ada@example.com', password: 'password123', storeName: 'Ada Store' });
    expect(session.user.role).toBe('owner');
    expect(session.accessToken).toEqual(expect.any(String));

    const logged = await auth.login({ email: 'ada@example.com', password: 'password123' });
    expect(logged.user.email).toBe('ada@example.com');

    await expect(auth.login({ email: 'ada@example.com', password: 'wrong' })).rejects.toThrow(UnauthorizedError);
    await expect(auth.login({ email: 'nobody@example.com', password: 'password123' })).rejects.toThrow(UnauthorizedError);
    await expect(auth.register({ name: 'Ada', email: 'ada@example.com', password: 'password123', storeName: 'S' })).rejects.toThrow(ConflictError);
  });

  it('rotates refresh tokens and expires sessions', async () => {
    const session = await auth.register({ name: 'Ada', email: 'refresh@example.com', password: 'password123', storeName: 'S' });

    const rotated = await auth.refresh(session.refreshToken);
    expect(rotated.accessToken).not.toBe(session.accessToken);
    await expect(auth.refresh(session.refreshToken)).rejects.toThrow(UnauthorizedError);

    const again = await auth.login({ email: 'refresh@example.com', password: 'password123' });
    t += 6000;
    await expect(auth.refresh(again.refreshToken)).rejects.toThrow(UnauthorizedError);
  });

  it('verifies tokens, exposes me and logs out', async () => {
    const session = await auth.register({ name: 'Ada', email: 'me@example.com', password: 'password123', storeName: 'S' });
    expect(auth.verifyAccess(session.accessToken)).not.toBeNull();

    t += 2000;
    expect(auth.verifyAccess(session.accessToken)).toBeNull();
    await expect(auth.me(session.accessToken)).resolves.toBeNull();

    const fresh = await auth.login({ email: 'me@example.com', password: 'password123' });
    await expect(auth.me(fresh.accessToken)).resolves.toMatchObject({ user: { email: 'me@example.com' } });
    auth.logout(fresh.accessToken);
    expect(auth.verifyAccess(fresh.accessToken)).toBeNull();
  });

  it('requests password resets for known and unknown emails', async () => {
    await auth.register({ name: 'Ada', email: 'reset@example.com', password: 'password123', storeName: 'S' });
    await expect(auth.requestPasswordReset({ email: 'reset@example.com' })).resolves.toEqual({ resetRequested: true });
    await expect(auth.requestPasswordReset({ email: 'ghost@example.com' })).resolves.toEqual({ resetRequested: true });
  });

  it('invites users, reuses same-tenant emails and rejects cross-tenant', async () => {
    const owner = await auth.register({ name: 'Owner', email: 'owner@example.com', password: 'password123', storeName: 'S' });
    const other = await auth.register({ name: 'Other', email: 'other@example.com', password: 'password123', storeName: 'Other' });

    const invited = await auth.inviteUser({
      tenantId: owner.user.tenantId,
      organizationId: owner.user.orgIds[0] ?? '',
      email: 'jo@example.com',
      name: 'Jo',
      role: 'member',
    });
    expect(invited.role).toBe('member');
    expect(auth.listUsers(owner.user.tenantId)).toHaveLength(2);

    const existing = await auth.inviteUser({
      tenantId: owner.user.tenantId,
      organizationId: owner.user.orgIds[0] ?? '',
      email: 'jo@example.com',
      name: 'Jo',
      role: 'viewer',
    });
    expect(existing.orgIds).toContain(owner.user.orgIds[0]);

    await expect(
      auth.inviteUser({
        tenantId: owner.user.tenantId,
        organizationId: owner.user.orgIds[0] ?? '',
        email: other.user.email,
        name: 'Other',
        role: 'member',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('updates user roles and rejects unknown users', async () => {
    const owner = await auth.register({ name: 'Owner', email: 'role@example.com', password: 'password123', storeName: 'S' });
    const updated = await auth.updateUserRole(owner.user.tenantId, owner.user.id, 'admin');
    expect(updated.role).toBe('admin');
    await expect(auth.updateUserRole(owner.user.tenantId, 'missing', 'admin')).rejects.toThrow(NotFoundError);
  });

  it('resolves users and resets state', async () => {
    const owner = await auth.register({ name: 'Owner', email: 'dir@example.com', password: 'password123', storeName: 'S' });
    expect(auth.userByEmail('DIR@example.com')?.userId).toBe(owner.user.id);
    expect(auth.userByEmail('nope@example.com')).toBeNull();
    expect(() => auth.requireUser('missing')).toThrow(NotFoundError);
    expect(auth.listUsers(owner.user.tenantId)).toHaveLength(1);

    auth.reset();
    expect(auth.listUsers(owner.user.tenantId)).toHaveLength(0);
    expect(auth.verifyAccess(owner.accessToken)).toBeNull();
  });

  it('applies default TTLs and id generator when options are omitted', async () => {
    const svc = new AuthService(makeEnterprise());
    const session = await svc.register({ name: 'Ada', email: 'defaults@example.com', password: 'password123', storeName: 'S' });
    expect(session.accessToken).toEqual(expect.any(String));
    expect(svc.userByEmail('defaults@example.com')?.userId).toEqual(expect.any(String));
  });

  it('rejects refresh and me when the session user no longer exists', async () => {
    const session = await auth.register({ name: 'Ada', email: 'gone@example.com', password: 'password123', storeName: 'S' });
    (auth as unknown as { users: Map<string, { userId: string }> }).users.delete(session.user.id);
    await expect(auth.refresh(session.refreshToken)).rejects.toThrow(UnauthorizedError);
    await expect(auth.me(session.accessToken)).resolves.toBeNull();
  });

  it('adds an existing same-tenant user to another organization', async () => {
    const owner = await auth.register({ name: 'Owner', email: 'orgs@example.com', password: 'password123', storeName: 'S' });
    const tenantId = owner.user.tenantId;
    const orgA = owner.user.orgIds[0] ?? '';
    const orgB = await enterprise.orgs.createOrganization(tenantId, 'Second Org');

    const invited = await auth.inviteUser({
      tenantId,
      organizationId: orgA,
      email: 'bob@example.com',
      name: 'Bob',
      role: 'member',
    });
    expect(invited.orgIds).toContain(orgA);

    const added = await auth.inviteUser({
      tenantId,
      organizationId: orgB.organizationId,
      email: 'bob@example.com',
      name: 'Bob',
      role: 'viewer',
    });
    expect(added.orgIds).toContain(orgB.organizationId);
  });

  it('verifies passwords with constant-time comparison', async () => {
    const { salt, hash } = await hashPassword('password123');
    await expect(verifyPassword('password123', salt, hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong', salt, hash)).resolves.toBe(false);
    await expect(verifyPassword('password123', salt, 'short')).resolves.toBe(false);
    await expect(verifyPassword('password123', salt, '')).resolves.toBe(false);
  });
});

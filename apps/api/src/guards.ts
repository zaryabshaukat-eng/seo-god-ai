/**
 * Route guards: the reusable pipeline every controller handler is wrapped in.
 * Guards resolve the caller (user session or machine API key), enforce
 * platform permissions and per-route rate limits before the handler runs.
 */

import type { Platform } from './platform.js';
import type { RequestContext, Principal } from './context.js';
import type { RouteHandler } from './router.js';
import { UnauthorizedError } from './errors.js';
import { bearerToken } from './http.js';
import { permissionsForRole, requirePlatformPermission, type PlatformPermission } from './permissions.js';
import { SlidingWindowRateLimiter, enforceLimit } from './rate-limit.js';

export interface RouteOptions {
  /** Require an authenticated caller (default true). */
  auth?: boolean;
  /** Platform permission the caller must hold. */
  permission?: PlatformPermission;
  /** Per-key request budget, keyed by `ip:route` by default. */
  rateLimit?: { windowMs: number; max: number };
}

/** Maps enterprise API-key scopes onto the platform permission vocabulary. */
const SCOPE_PERMISSIONS: Record<string, PlatformPermission> = {
  'tenant.read': 'dashboard.read',
  'tenant.write': 'settings.write',
  'orgs.read': 'admin.read',
  'orgs.write': 'admin.write',
  'teams.write': 'admin.write',
  'audit.read': 'admin.read',
  'apikeys.manage': 'admin.write',
  'webhooks.manage': 'admin.write',
  'billing.read': 'admin.read',
  'billing.manage': 'admin.write',
};

export function platformPermissionsFromScopes(scopes: readonly string[]): string[] {
  const permissions: string[] = [];
  for (const scope of scopes) {
    const permission = SCOPE_PERMISSIONS[scope];
    if (permission !== undefined && !permissions.includes(permission)) {
      permissions.push(permission);
    }
  }
  return permissions;
}

/** Resolves the caller from the request, populating `ctx.principal`. */
export async function authenticate(platform: Platform, ctx: RequestContext): Promise<void> {
  const bearer = bearerToken(ctx.headers);
  const apiKey = ctx.headers['x-api-key'];
  const queryToken = ctx.query.get('access_token');
  if (bearer !== undefined || queryToken !== null) {
    const token = bearer ?? queryToken ?? '';
    const session = platform.auth.verifyAccess(token);
    if (session === null) {
      throw new UnauthorizedError('Invalid or expired access token.');
    }
    const user = platform.auth.requireUser(session.userId);
    ctx.principal = userPrincipal(user);
    ctx.tenantId = user.tenantId;
    return;
  }
  if (typeof apiKey === 'string') {
    const record = platform.enterprise.apiKeys.verifyKey(apiKey);
    if (record === null) {
      throw new UnauthorizedError('Invalid API key.');
    }
    ctx.principal = {
      kind: 'api_key',
      keyId: record.keyId,
      name: record.name,
      role: 'api_key',
      tenantId: record.tenantId,
      permissions: platformPermissionsFromScopes(record.scopes),
    };
    ctx.tenantId = record.tenantId;
    return;
  }
  throw new UnauthorizedError('Missing credentials: expected a bearer token or an API key.');
}

export function userPrincipal(user: {
  userId: string;
  name: string;
  email: string;
  role: string;
  tenantId: string;
}): Principal {
  return {
    kind: 'user',
    userId: user.userId,
    name: user.name,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    permissions: [...permissionsForRole(user.role)],
  };
}

/**
 * Wraps a handler with auth, permission and rate-limit checks. Route handlers
 * registered through `guard` can rely on `ctx.principal` being set.
 */
export function guard(platform: Platform, options: RouteOptions, handler: RouteHandler): RouteHandler {
  const limiter =
    options.rateLimit === undefined ? null : new SlidingWindowRateLimiter(options.rateLimit);
  return async (ctx) => {
    if (limiter !== null) {
      enforceLimit(limiter, `${ctx.ip}:${ctx.pathname}`);
    }
    if (options.auth !== false) {
      await authenticate(platform, ctx);
    }
    if (options.permission !== undefined) {
      requirePlatformPermission(ctx.principal, options.permission);
    }
    await handler(ctx);
  };
}

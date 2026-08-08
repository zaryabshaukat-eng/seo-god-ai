/**
 * Auth endpoints: register, login, refresh, reset-password, me, logout.
 * Mirrors `apps/web/src/api/endpoints.ts` `auth.*` contract.
 */

import type { Platform } from '../platform.js';
import type { Router } from '../router.js';
import { bodyAs } from '../context.js';
import { UnauthorizedError } from '../errors.js';
import { guard } from '../guards.js';
import { bearerToken, sendJson, sendNoContent } from '../http.js';
import { requireString } from '../validation.js';

export function registerAuthRoutes(platform: Platform, router: Router): void {
  router.on(
    'POST',
    '/api/v1/auth/register',
    guard(platform, { auth: false, rateLimit: { windowMs: 60_000, max: 10 } }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const session = await platform.auth.register({
        name: requireString(body, 'name', 'Name'),
        email: requireString(body, 'email', 'Email'),
        password: requireString(body, 'password', 'Password'),
        storeName: requireString(body, 'storeName', 'Store name'),
      });
      sendJson(ctx.res, 201, session);
    }),
  );

  router.on(
    'POST',
    '/api/v1/auth/login',
    guard(platform, { auth: false, rateLimit: { windowMs: 60_000, max: 20 } }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const session = await platform.auth.login({
        email: requireString(body, 'email', 'Email'),
        password: requireString(body, 'password', 'Password'),
      });
      sendJson(ctx.res, 200, session);
    }),
  );

  router.on(
    'POST',
    '/api/v1/auth/refresh',
    guard(platform, { auth: false }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const session = await platform.auth.refresh(requireString(body, 'refreshToken', 'Refresh token'));
      sendJson(ctx.res, 200, session);
    }),
  );

  router.on(
    'POST',
    '/api/v1/auth/reset-password',
    guard(platform, { auth: false, rateLimit: { windowMs: 60_000, max: 5 } }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const result = await platform.auth.requestPasswordReset({
        email: requireString(body, 'email', 'Email'),
      });
      sendJson(ctx.res, 200, result);
    }),
  );

  router.on(
    'GET',
    '/api/v1/auth/me',
    guard(platform, {}, async (ctx) => {
      const principal = ctx.principal;
      if (principal === undefined) throw new UnauthorizedError('Not authenticated.');
      sendJson(ctx.res, 200, {
        user: {
          id: principal.userId,
          name: principal.name,
          email: principal.email,
          role: principal.role,
          tenantId: principal.tenantId,
        },
        permissions: principal.permissions,
      });
    }),
  );

  router.on(
    'POST',
    '/api/v1/auth/logout',
    guard(platform, {}, async (ctx) => {
      const token = bearerToken(ctx.headers);
      if (token !== undefined) {
        platform.auth.logout(token);
      }
      sendNoContent(ctx.res);
    }),
  );
}

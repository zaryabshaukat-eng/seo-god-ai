/**
 * Settings endpoints: workspace settings and per-user profile preferences.
 * Workspace settings are tenant-scoped; profile preferences are scoped to
 * `tenant + user` so each member keeps their own view.
 */

import type { Platform } from '../platform.js';
import type { Router } from '../router.js';
import { bodyAs } from '../context.js';
import { guard } from '../guards.js';
import { sendJson } from '../http.js';
import { PlatformPermissions } from '../permissions.js';
import { optionalBoolean, optionalString } from '../validation.js';

const SETTING_KEYS = [
  'storeName',
  'shopDomain',
  'locale',
  'timezone',
  'notificationsEnabled',
  'requireApproval',
  'theme',
] as const;

const PROFILE_KEYS = ['locale', 'timezone', 'theme'] as const;

function pickKnown(body: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in body) {
      const value = body[key];
      if (key === 'notificationsEnabled' || key === 'requireApproval') {
        patch[key] = optionalBoolean(body, key) ?? false;
      } else if (key === 'storeName' || key === 'shopDomain' || key === 'locale' || key === 'timezone' || key === 'theme') {
        patch[key] = optionalString(body, key) ?? '';
      } else {
        patch[key] = value;
      }
    }
  }
  return patch;
}

export function registerSettingsRoutes(platform: Platform, router: Router): void {
  router.on(
    'GET',
    '/api/v1/settings',
    guard(platform, { permission: PlatformPermissions.settingsRead }, async (ctx) => {
      sendJson(ctx.res, 200, { settings: platform.settings.get(ctx.tenantId ?? '') });
    }),
  );

  router.on(
    'PUT',
    '/api/v1/settings',
    guard(platform, { permission: PlatformPermissions.settingsWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const settings = platform.settings.update(ctx.tenantId ?? '', pickKnown(body, SETTING_KEYS));
      sendJson(ctx.res, 200, { settings });
    }),
  );

  router.on(
    'PATCH',
    '/api/v1/settings/profile',
    guard(platform, { permission: PlatformPermissions.settingsWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const tenantId = ctx.tenantId ?? '';
      const userId = ctx.principal?.userId ?? '';
      const profile = platform.settings.updateProfile(tenantId, userId, pickKnown(body, PROFILE_KEYS));
      sendJson(ctx.res, 200, { profile });
    }),
  );
}

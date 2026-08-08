/**
 * Plugin management endpoints. The API exposes the `@seogod/plugin-sdk`
 * registry as tenant-scoped admin surface: install, update, enable, disable
 * and uninstall plugins declared as `{ manifest, code }` bundles, plus
 * contribution dispatch so the platform can invoke sandboxed analyzers,
 * tools and execution actions contributed by enabled plugins.
 *
 * Management reads require `plugins.read`; mutations require `plugins.write`.
 * Runtime plugin permissions are enforced by the registry itself — a plugin
 * can never run a contribution it was not approved for, and every plugin
 * error is normalized by `mapKnownError` into a canonical HTTP response.
 */

import type { PluginActionInput, PluginAnalyzerContext, PluginManifest } from '@seogod/plugin-sdk';
import type { Platform } from '../platform.js';
import type { Router } from '../router.js';
import { bodyAs, requireParam } from '../context.js';
import { ApiValidationError } from '../errors.js';
import { guard } from '../guards.js';
import { sendJson } from '../http.js';
import { PlatformPermissions } from '../permissions.js';
import { requireRecord, requireString } from '../validation.js';

function pluginShape(plugin: { id: string; name: string; version: string; state: string; permissions: readonly string[] }): Record<string, unknown> {
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    state: plugin.state,
    permissions: [...plugin.permissions],
  };
}

export function registerPluginRoutes(platform: Platform, router: Router): void {
  router.on(
    'GET',
    '/api/v1/admin/plugins',
    guard(platform, { permission: PlatformPermissions.pluginsRead }, async (ctx) => {
      sendJson(ctx.res, 200, { plugins: platform.plugins.list().map(pluginShape) });
    }),
  );

  router.on(
    'POST',
    '/api/v1/admin/plugins',
    guard(platform, { permission: PlatformPermissions.pluginsWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const code = requireString(body, 'code', 'Code');
      const manifest = requireRecord(body, 'manifest');
      const plugin = platform.plugins.install({
        manifest: manifest as unknown as PluginManifest,
        code,
      });
      sendJson(ctx.res, 201, { plugin: pluginShape(plugin) });
    }),
  );

  router.on(
    'GET',
    '/api/v1/admin/plugins/:id',
    guard(platform, { permission: PlatformPermissions.pluginsRead }, async (ctx) => {
      sendJson(ctx.res, 200, { plugin: pluginShape(platform.plugins.require(requireParam(ctx, 'id'))) });
    }),
  );

  router.on(
    'PUT',
    '/api/v1/admin/plugins/:id',
    guard(platform, { permission: PlatformPermissions.pluginsWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const code = requireString(body, 'code', 'Code');
      const manifest = requireRecord(body, 'manifest');
      const plugin = platform.plugins.update(requireParam(ctx, 'id'), {
        manifest: manifest as unknown as PluginManifest,
        code,
      });
      sendJson(ctx.res, 200, { plugin: pluginShape(plugin) });
    }),
  );

  router.on(
    'DELETE',
    '/api/v1/admin/plugins/:id',
    guard(platform, { permission: PlatformPermissions.pluginsWrite }, async (ctx) => {
      const plugin = platform.plugins.uninstall(requireParam(ctx, 'id'));
      sendJson(ctx.res, 200, { plugin: pluginShape(plugin) });
    }),
  );

  router.on(
    'POST',
    '/api/v1/admin/plugins/:id/enable',
    guard(platform, { permission: PlatformPermissions.pluginsWrite }, async (ctx) => {
      const plugin = platform.plugins.enable(requireParam(ctx, 'id'));
      sendJson(ctx.res, 200, { plugin: pluginShape(plugin) });
    }),
  );

  router.on(
    'POST',
    '/api/v1/admin/plugins/:id/disable',
    guard(platform, { permission: PlatformPermissions.pluginsWrite }, async (ctx) => {
      const plugin = platform.plugins.disable(requireParam(ctx, 'id'));
      sendJson(ctx.res, 200, { plugin: pluginShape(plugin) });
    }),
  );

  router.on(
    'POST',
    '/api/v1/admin/plugins/dispatch/tools/:toolId',
    guard(platform, { permission: PlatformPermissions.pluginsWrite }, async (ctx) => {
      const body = bodyAs<{ args?: Record<string, unknown> }>(ctx);
      const args = body?.args ?? {};
      const result = await platform.plugins.executeTool(requireParam(ctx, 'toolId'), args);
      sendJson(ctx.res, 200, { result });
    }),
  );

  router.on(
    'POST',
    '/api/v1/admin/plugins/dispatch/analyzers/:analyzerId',
    guard(platform, { permission: PlatformPermissions.pluginsWrite }, async (ctx) => {
      const body = bodyAs<{ context?: PluginAnalyzerContext }>(ctx);
      const context = body?.context ?? {};
      const output = await platform.plugins.runAnalyzer(requireParam(ctx, 'analyzerId'), context);
      sendJson(ctx.res, 200, { analyzer: output });
    }),
  );

  router.on(
    'POST',
    '/api/v1/admin/plugins/dispatch/actions/:actionId',
    guard(platform, { permission: PlatformPermissions.pluginsWrite }, async (ctx) => {
      const body = bodyAs<{ action?: unknown; payload?: unknown }>(ctx);
      if (body === undefined || typeof body.action !== 'string' || body.action.length === 0) {
        throw new ApiValidationError('action is required.', { action: 'action is required.' });
      }
      const input: PluginActionInput = { action: body.action, payload: body.payload };
      const result = await platform.plugins.executeAction(requireParam(ctx, 'actionId'), input);
      sendJson(ctx.res, 200, { result });
    }),
  );
}

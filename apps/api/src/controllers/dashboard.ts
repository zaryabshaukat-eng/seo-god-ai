/**
 * Dashboard + observability endpoints: overviews, trends, execution metrics,
 * alerts and the immutable history timeline.
 */

import type { Platform } from '../platform.js';
import type { Router } from '../router.js';
import { bodyAs, requireParam } from '../context.js';
import { NotFoundError } from '../errors.js';
import { guard } from '../guards.js';
import { sendJson } from '../http.js';
import { optionalBoolean, optionalNumber, optionalString } from '../validation.js';
import { PlatformPermissions } from '../permissions.js';

function storeIdOf(ctx: { query: URLSearchParams }): string | undefined {
  return optionalString({ storeId: ctx.query.get('storeId') ?? undefined }, 'storeId');
}

function limitOf(ctx: { query: URLSearchParams }): number | undefined {
  return optionalNumber({ limit: ctx.query.get('limit') ?? undefined }, 'limit');
}

export function registerDashboardRoutes(platform: Platform, router: Router): void {
  router.on(
    'GET',
    '/api/v1/dashboard/overview',
    guard(platform, { permission: PlatformPermissions.dashboardRead }, async (ctx) => {
      const storeId = storeIdOf(ctx);
      const overview = await platform.observability.getOverview(storeId);
      sendJson(ctx.res, 200, {
        overview,
        settings: platform.settings.get(ctx.tenantId ?? ''),
        unreadNotifications: platform.notifications.unreadCount(ctx.tenantId ?? ''),
      });
    }),
  );

  router.on(
    'GET',
    '/api/v1/dashboard/trends',
    guard(platform, { permission: PlatformPermissions.dashboardRead }, async (ctx) => {
      const storeId = storeIdOf(ctx);
      const options = { storeId, limit: limitOf(ctx) };
      const [seo, execution, performance] = await Promise.all([
        platform.observability.getSeoTimeline(options),
        platform.observability.getExecutionTimeline(options),
        platform.observability.getPerformanceTimeline(options),
      ]);
      sendJson(ctx.res, 200, { seo, execution, performance });
    }),
  );
}

export function registerObservabilityRoutes(platform: Platform, router: Router): void {
  router.on(
    'GET',
    '/api/v1/observability/overview',
    guard(platform, { permission: PlatformPermissions.observabilityRead }, async (ctx) => {
      sendJson(ctx.res, 200, await platform.observability.getOverview(storeIdOf(ctx)));
    }),
  );

  router.on(
    'GET',
    '/api/v1/observability/metrics',
    guard(platform, { permission: PlatformPermissions.observabilityRead }, async (ctx) => {
      sendJson(ctx.res, 200, await platform.observability.getExecutionMetrics(storeIdOf(ctx)));
    }),
  );

  router.on(
    'GET',
    '/api/v1/observability/alerts',
    guard(platform, { permission: PlatformPermissions.observabilityRead }, async (ctx) => {
      const alerts = await platform.observability.getAlerts(storeIdOf(ctx), limitOf(ctx));
      sendJson(ctx.res, 200, {
        alerts: alerts.map((alert) => ({
          ...alert,
          acknowledged: platform.acknowledgedAlerts.has(alert.alertId),
        })),
      });
    }),
  );

  router.on(
    'GET',
    '/api/v1/observability/timeline',
    guard(platform, { permission: PlatformPermissions.observabilityRead }, async (ctx) => {
      const history = await platform.observability.getHistory({
        storeId: storeIdOf(ctx),
        limit: limitOf(ctx),
      });
      sendJson(ctx.res, 200, history);
    }),
  );

  router.on(
    'POST',
    '/api/v1/observability/alerts/:id/acknowledge',
    guard(platform, { permission: PlatformPermissions.observabilityRead }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const alertId = requireParam(ctx, 'id');
      const alerts = await platform.observability.getAlerts(undefined, 1000);
      const exists = alerts.some((alert) => alert.alertId === alertId);
      if (!exists) {
        throw new NotFoundError(`Alert '${alertId}' not found.`);
      }
      const acknowledged = optionalBoolean(body, 'acknowledged') ?? true;
      if (acknowledged) {
        platform.acknowledgedAlerts.add(alertId);
      } else {
        platform.acknowledgedAlerts.delete(alertId);
      }
      sendJson(ctx.res, 200, { alertId, acknowledged });
    }),
  );
}

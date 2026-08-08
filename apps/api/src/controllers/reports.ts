/**
 * Report endpoints: list generated reports, generate on demand, fetch one.
 * Generated reports are kept in the platform's in-memory report store.
 */

import type { Platform } from '../platform.js';
import type { Router } from '../router.js';
import { bodyAs, requireParam } from '../context.js';
import { NotFoundError } from '../errors.js';
import { guard } from '../guards.js';
import { sendJson } from '../http.js';
import { PlatformPermissions } from '../permissions.js';
import { optionalBoolean, optionalNumber, optionalString, requireEnum } from '../validation.js';

const REPORT_KINDS = ['executive-dashboard', 'seo', 'kpi', 'trends', 'alerts'] as const;

function reportShape(report: { rendered?: unknown }): Record<string, unknown> {
  return { ...report, rendered: undefined };
}

export function registerReportRoutes(platform: Platform, router: Router): void {
  router.on(
    'GET',
    '/api/v1/reports',
    guard(platform, { permission: PlatformPermissions.reportsRead }, async (ctx) => {
      const reports = [...platform.reportStore.values()]
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
        .map((report) => ({
          id: report.id,
          kind: report.kind,
          name: report.name,
          storeId: report.storeId,
          period: report.period,
          generatedAt: report.generatedAt,
        }));
      sendJson(ctx.res, 200, { reports });
    }),
  );

  router.on(
    'POST',
    '/api/v1/reports',
    guard(platform, { permission: PlatformPermissions.reportsWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const kind = requireEnum(body, 'kind', REPORT_KINDS, 'Kind');
      const storeId = optionalString(body, 'storeId');
      const days = optionalNumber(body, 'days');
      const compare = optionalBoolean(body, 'compare');
      const report = await platform.reports.generateAndTrack({
        kind,
        storeId,
        days,
        compare,
        renderers: ['json'],
      });
      platform.reportStore.set(report.id, report);
      sendJson(ctx.res, 201, { report: reportShape(report) });
    }),
  );

  router.on(
    'GET',
    '/api/v1/reports/:id',
    guard(platform, { permission: PlatformPermissions.reportsRead }, async (ctx) => {
      const id = requireParam(ctx, 'id');
      const report = platform.reportStore.get(id);
      if (report === undefined) {
        throw new NotFoundError(`Report '${id}' not found.`);
      }
      sendJson(ctx.res, 200, { report: reportShape(report) });
    }),
  );
}

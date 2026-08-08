/**
 * Crawl, SEO and execution endpoints. Crawl jobs come from the crawler's
 * datastore; SEO recommendations are derived from the latest observability
 * snapshot; executions are observability records overlaid with the approval
 * state machine kept by the platform.
 */

import type { CrawlJob } from '@prisma/client';
import type { Platform } from '../platform.js';
import type { Router } from '../router.js';
import { bodyAs, requireParam } from '../context.js';
import { NotFoundError } from '../errors.js';
import { guard } from '../guards.js';
import { sendJson } from '../http.js';
import { PlatformPermissions } from '../permissions.js';
import { optionalArray, optionalString, requireEnum, requireString } from '../validation.js';
import type { SeoSnapshot } from '@seogod/observability';

const CRAWL_STATUSES: Record<string, string> = {
  PENDING: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

function crawlShape(job: CrawlJob): Record<string, unknown> {
  const started = job.startedAt?.getTime() ?? job.createdAt.getTime();
  return {
    id: job.id,
    storeId: job.storeId,
    status: CRAWL_STATUSES[job.status] ?? job.status.toLowerCase(),
    pages: job.totalPages,
    issues: (job.statistics as { totalIssues?: number } | null)?.totalIssues ?? 0,
    startedAt: started,
    finishedAt: job.finishedAt?.getTime(),
    error: job.error ?? undefined,
    seeds: job.seeds,
  };
}

async function latestSnapshot(platform: Platform, storeId: string | undefined): Promise<SeoSnapshot | null> {
  const history = await platform.observability.getHistory({ storeId, limit: 1 });
  const snapshots = history.snapshots;
  return snapshots.length === 0 ? null : (snapshots[0] ?? null);
}

function recommendationShape(
  platform: Platform,
  storeId: string,
  snapshot: SeoSnapshot,
  category: string,
  score: number,
  index: number,
): Record<string, unknown> {
  const id = `rec_${snapshot.snapshotId}_${category}`;
  const status = platform.recommendationOverrides.get(id)?.status ?? 'open';
  return {
    id,
    storeId,
    rule: category,
    severity: score < 50 ? 'high' : score < 75 ? 'medium' : 'low',
    url: '',
    title: `Improve ${category}`,
    description: `Category score is ${score}/100.`,
    score,
    impact: 'ranking',
    status,
    createdAt: Date.parse(snapshot.capturedAt) + index,
  };
}

export function registerCrawlRoutes(platform: Platform, router: Router): void {
  router.on(
    'GET',
    '/api/v1/crawls',
    guard(platform, { permission: PlatformPermissions.crawlRead }, async (ctx) => {
      const storeId = ctx.query.get('storeId');
      const jobs = platform
        .listCrawlJobs()
        .filter((job) => storeId === null || job.storeId === storeId)
        .map(crawlShape);
      sendJson(ctx.res, 200, { crawls: jobs });
    }),
  );

  router.on(
    'POST',
    '/api/v1/crawls',
    guard(platform, { permission: PlatformPermissions.crawlWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const storeId = requireString(body, 'storeId', 'Store id');
      const seeds =
        body.seeds === undefined
          ? [`https://${storeId}.myshopify.com/`]
          : optionalArray(body, 'seeds').map(String);
      if (seeds.length === 0) {
        throw new Error('At least one seed URL is required.');
      }
      const result = await platform.startCrawl(storeId, seeds);
      const job = platform.getCrawlJob(result.crawlJobId);
      sendJson(ctx.res, 201, {
        crawl: job === null ? { id: result.crawlJobId, storeId, status: result.status.toLowerCase() } : crawlShape(job),
        statistics: result.statistics,
      });
    }),
  );

  router.on(
    'GET',
    '/api/v1/crawls/:id',
    guard(platform, { permission: PlatformPermissions.crawlRead }, async (ctx) => {
      const id = requireParam(ctx, 'id');
      const job = platform.getCrawlJob(id);
      if (job === null) {
        throw new NotFoundError(`Crawl job '${id}' not found.`);
      }
      sendJson(ctx.res, 200, { crawl: crawlShape(job) });
    }),
  );

  router.on(
    'POST',
    '/api/v1/crawls/:id/cancel',
    guard(platform, { permission: PlatformPermissions.crawlWrite }, async (ctx) => {
      const job = platform.cancelCrawl(requireParam(ctx, 'id'));
      sendJson(ctx.res, 200, { crawl: crawlShape(job) });
    }),
  );
}

export function registerSeoRoutes(platform: Platform, router: Router): void {
  router.on(
    'GET',
    '/api/v1/seo/recommendations',
    guard(platform, { permission: PlatformPermissions.seoRead }, async (ctx) => {
      const storeId = optionalString({ storeId: ctx.query.get('storeId') ?? undefined }, 'storeId');
      const snapshot = await latestSnapshot(platform, storeId);
      const recommendations: Record<string, unknown>[] = [];
      if (snapshot !== null) {
        const scores = snapshot.scores ?? {};
        let index = 0;
        for (const [category, score] of Object.entries(scores)) {
          recommendations.push(recommendationShape(platform, snapshot.storeId, snapshot, category, score, index));
          index += 1;
        }
      }
      sendJson(ctx.res, 200, { recommendations });
    }),
  );

  router.on(
    'GET',
    '/api/v1/seo/breakdown',
    guard(platform, { permission: PlatformPermissions.seoRead }, async (ctx) => {
      const storeId = optionalString({ storeId: ctx.query.get('storeId') ?? undefined }, 'storeId');
      const snapshot = await latestSnapshot(platform, storeId);
      const categories =
        snapshot === null
          ? []
          : Object.entries(snapshot.scores ?? {}).map(([category, score]) => ({
              category,
              score,
              severity: score < 50 ? 'high' : score < 75 ? 'medium' : 'low',
            }));
      sendJson(ctx.res, 200, { score: snapshot?.overallScore ?? null, categories });
    }),
  );

  router.on(
    'PATCH',
    '/api/v1/seo/recommendations/:id',
    guard(platform, { permission: PlatformPermissions.seoWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const status = requireEnum(body, 'status', ['open', 'planned', 'resolved'], 'Status');
      const id = requireParam(ctx, 'id');
      platform.recommendationOverrides.set(id, { status });
      sendJson(ctx.res, 200, { id, status });
    }),
  );
}

export function registerExecutionRoutes(platform: Platform, router: Router): void {
  const ACTION_STATUS: Record<string, string> = {
    approve: 'approved',
    reject: 'cancelled',
    rollback: 'rolled-back',
    run: 'running',
  };

  router.on(
    'GET',
    '/api/v1/executions',
    guard(platform, { permission: PlatformPermissions.executionRead }, async (ctx) => {
      const storeId = ctx.query.get('storeId');
      const history = await platform.observability.getHistory({ storeId: storeId ?? undefined, limit: 100 });
      const executions = history.executions.map((record) => {
        const overrides = platform.executionStates.get(record.executionId) ?? {};
        return {
          id: record.executionId,
          storeId: record.storeId,
          title: record.operation ?? record.entityType ?? 'Execution',
          status: overrides.status ?? record.status.toLowerCase(),
          risk: 'medium',
          changes: (record as { totalSteps?: number }).totalSteps ?? 0,
          approvalRole: 'owner',
          createdBy: record.entityId ?? 'system',
          createdAt: Date.parse(record.startedAt),
          startedAt: Date.parse(record.startedAt),
          completedAt: record.completedAt === undefined ? undefined : Date.parse(record.completedAt),
          error: record.error,
        };
      });
      sendJson(ctx.res, 200, { executions });
    }),
  );

  router.on(
    'GET',
    '/api/v1/executions/:id',
    guard(platform, { permission: PlatformPermissions.executionRead }, async (ctx) => {
      const id = requireParam(ctx, 'id');
      const history = await platform.observability.getHistory({ limit: 1000 });
      const record = history.executions.find((entry) => entry.executionId === id);
      if (record === undefined) {
        throw new NotFoundError(`Execution '${ctx.params.id}' not found.`);
      }
      const overrides = platform.executionStates.get(record.executionId) ?? {};
      sendJson(ctx.res, 200, {
        execution: {
          id: record.executionId,
          storeId: record.storeId,
          title: record.operation ?? record.entityType ?? 'Execution',
          status: overrides.status ?? record.status.toLowerCase(),
          risk: 'medium',
          changes: (record as { totalSteps?: number }).totalSteps ?? 0,
          approvalRole: 'owner',
          createdBy: record.entityId ?? 'system',
          createdAt: Date.parse(record.startedAt),
          startedAt: Date.parse(record.startedAt),
          completedAt: record.completedAt === undefined ? undefined : Date.parse(record.completedAt),
          error: record.error,
        },
      });
    }),
  );

  for (const action of Object.keys(ACTION_STATUS)) {
    router.on(
      'POST',
      `/api/v1/executions/:id/${action}`,
      guard(platform, { permission: PlatformPermissions.executionWrite }, async (ctx) => {
        const id = requireParam(ctx, 'id');
        const history = await platform.observability.getHistory({ limit: 1000 });
        const record = history.executions.find((entry) => entry.executionId === id);
        if (record === undefined) {
          throw new NotFoundError(`Execution '${id}' not found.`);
        }
        const status = ACTION_STATUS[action];
        platform.executionStates.set(record.executionId, { status });
        sendJson(ctx.res, 200, { id: record.executionId, status, action });
      }),
    );
  }
}

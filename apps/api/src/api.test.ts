/**
 * Full-stack integration tests. Each suite boots a real `ApiServer` on an
 * ephemeral port and drives it over HTTP, exercising the middleware pipeline,
 * guards, RBAC and every controller's happy path and error branches.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CrawlJob } from '@prisma/client';
import type { ChatModel } from '@seogod/ai-copilot';
import { boot, createPlatform, api, register, login, stopQuietly, type Harness } from '../test/harness.js';
import { ApiError } from './errors.js';

const FIXED_NOW = '2026-01-15T12:00:00.000Z';

async function seedObservability(harness: Harness): Promise<void> {
  await harness.platform.observabilityStore.upsertExecution({
    executionId: 'ex_1',
    storeId: 'store-1',
    status: 'COMPLETED',
    startedAt: FIXED_NOW,
    completedAt: FIXED_NOW,
    operation: 'meta:title',
    entityType: 'page',
    entityId: 'page-1',
    totalSteps: 3,
    durationMs: 1200,
  });
  await harness.platform.observabilityStore.upsertExecution({
    executionId: 'ex_2',
    storeId: 'store-1',
    status: 'FAILED',
    startedAt: FIXED_NOW,
    entityType: 'page',
    entityId: 'page-2',
    operation: 'heading',
    error: 'boom',
  });
  await harness.platform.observabilityStore.appendSnapshot({
    snapshotId: 'snap_1',
    storeId: 'store-1',
    capturedAt: FIXED_NOW,
    overallScore: 61,
    scores: { title: 40, description: 66, performance: 85 },
    pagesCrawled: 12,
    totalIssues: 7,
  });
  await harness.platform.observabilityStore.appendAlert({
    alertId: 'alert_1',
    type: 'execution_failure',
    severity: 'critical',
    message: 'Executions failing at a high rate.',
    triggeredAt: FIXED_NOW,
    storeId: 'store-1',
    context: { failures: 3 },
  });
}

function seedCrawlJob(harness: Harness, id: string, status: string, overrides: Partial<CrawlJob> = {}): CrawlJob {
  const job = {
    id,
    storeId: 'store-1',
    status,
    totalPages: 2,
    seeds: ['https://store-1.myshopify.com/'],
    statistics: null,
    error: null,
    createdAt: new Date(FIXED_NOW),
    startedAt: status === 'PENDING' ? null : new Date(FIXED_NOW),
    finishedAt: null,
    ...overrides,
  } as CrawlJob;
  harness.platform.db.jobs.set(id, job);
  return job;
}

function crawlFetch(url: string): Promise<Response> {
  const target = String(url);
  if (target.includes('robots.txt')) {
    return Promise.resolve(new Response('User-agent: *\nDisallow:\n', { status: 200 }));
  }
  return Promise.resolve(
    new Response(
      '<html><head><title>My Store</title><meta name="description" content="Welcome to my store"></head><body><h1>Welcome</h1></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ),
  );
}

const USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

const toolModel: ChatModel = {
  name: 'tool-model',
  models: ['tool-demo'],
  async *stream(request) {
    const toolTurn = request.messages.some((message) => message.role === 'tool' || message.role === 'assistant');
    if (toolTurn) {
      yield { type: 'delta', text: 'All set.' };
      yield { type: 'done', response: { text: 'All set.', toolCalls: [], usage: USAGE, model: 'tool-demo' } };
      return;
    }
    yield { type: 'tool-call', call: { id: 'call_1', name: 'list_recommendations', arguments: '{}' } };
    yield { type: 'done', response: { text: '', toolCalls: [], usage: USAGE, model: 'tool-demo' } };
  },
};

const throwingModel: ChatModel = {
  name: 'throwing-model',
  models: ['throw-demo'],
  async *stream() {
    yield await Promise.reject(new Error('model exploded'));
  },
};

const throwingValue: ChatModel = {
  name: 'throwing-value',
  models: ['throw-value'],
  async *stream() {
    yield await Promise.reject({ message: 'object failure' } as unknown as Error);
  },
};

async function newHarness(): Promise<Harness> {
  return boot();
}

describe('server basics', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await newHarness();
  });
  afterEach(async () => {
    await stopQuietly(h);
  });

  it('serves health, ready and metrics', async () => {
    const health = await api(h, '/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual(expect.objectContaining({ status: 'ok' }));

    const ready = await api(h, '/ready');
    expect(ready.status).toBe(200);

    const metrics = await api(h, '/metrics', { raw: true });
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get('content-type')).toContain('text/plain');
    expect(metrics.text.length).toBeGreaterThan(0);
  });

  it('answers CORS preflight and sets CORS headers on responses', async () => {
    const preflight = await api(h, '/api/v1/auth/me', { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');

    const regular = await api(h, '/health');
    expect(regular.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('propagates and generates request ids', async () => {
    const echoed = await api(h, '/health', { headers: { 'x-request-id': 'client-123' } });
    expect(echoed.headers.get('x-request-id')).toBe('client-123');

    const generated = await api(h, '/health');
    expect(generated.headers.get('x-request-id')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns canonical 404 and 405 envelopes', async () => {
    const notFound = await api(h, '/api/v1/does-not-exist');
    expect(notFound.status).toBe(404);
    expect(notFound.body).toEqual({ error: { code: 'not_found', message: expect.any(String), retryable: false } });

    const badMethod = await api(h, '/api/v1/auth/me', { method: 'POST' });
    expect(badMethod.status).toBe(405);
    expect((badMethod.body as any).error.code).toBe('method_not_allowed');
  });

  it('normalizes unexpected handler errors to 500 with the canonical envelope', async () => {
    const boom = await boot({
      server: {
        routes: (router) => {
          router.on('GET', '/boom', async () => {
            throw new Error('kaboom');
          });
        },
      },
    });
    try {
      const result = await api(boom, '/boom');
      expect(result.status).toBe(500);
      expect(result.body).toEqual({ error: { code: 'internal_error', message: 'kaboom', retryable: true } });
    } finally {
      await stopQuietly(boom);
    }
  });

  it('preserves thrown ApiError status codes and fallback headers', async () => {
    const custom = await boot({
      server: {
        routes: (router) => {
          router.on('GET', '/plain-500', async () => {
            throw new ApiError(500, 'sad', { code: 'internal_error' });
          });
          router.on('GET', '/plain-429', async () => {
            throw new ApiError(429, 'hold on', { code: 'rate_limited' });
          });
        },
      },
    });
    try {
      const five = await api(custom, '/plain-500');
      expect(five.status).toBe(500);
      expect(five.body).toEqual({ error: { code: 'internal_error', message: 'sad', retryable: true } });

      const limited = await api(custom, '/plain-429');
      expect(limited.status).toBe(429);
      expect(limited.body).toEqual({ error: { code: 'rate_limited', message: 'hold on', retryable: true } });
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    } finally {
      await stopQuietly(custom);
    }
  });

  it('rate limits anonymous routes and sets retry-after', async () => {
    for (let index = 0; index < 5; index += 1) {
      const ok = await api(h, '/api/v1/auth/reset-password', { method: 'POST', body: { email: `r${index}@example.com` } });
      expect(ok.status).toBe(200);
    }
    const limited = await api(h, '/api/v1/auth/reset-password', { method: 'POST', body: { email: 'r6@example.com' } });
    expect(limited.status).toBe(429);
    expect((limited.body as any).error.code).toBe('rate_limited');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('auth', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await newHarness();
  });
  afterEach(async () => {
    await stopQuietly(h);
  });

  it('registers, logs in, refreshes, reads me and logs out', async () => {
    const { session, token } = await register(h, { email: 'owner@example.com' });
    expect(session.accessToken).toEqual(expect.any(String));
    expect(session.user.role).toBe('owner');
    expect(session.user.tenantId).toEqual(expect.any(String));

    const me = await api(h, '/api/v1/auth/me', { token });
    expect(me.status).toBe(200);
    expect((me.body as any).user.email).toBe('owner@example.com');
    expect((me.body as any).permissions).toContain('admin.write');

    const loginResult = await login(h, 'owner@example.com');
    expect(loginResult.accessToken).toEqual(expect.any(String));

    const refreshed = await api(h, '/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: session.refreshToken },
    });
    expect(refreshed.status).toBe(200);

    const logout = await api(h, '/api/v1/auth/logout', { method: 'POST', token: loginResult.accessToken });
    expect(logout.status).toBe(204);
    const after = await api(h, '/api/v1/auth/me', { token: loginResult.accessToken });
    expect(after.status).toBe(401);
  });

  it('rejects duplicate registrations and invalid input', async () => {
    await register(h, { email: 'dup@example.com' });
    const duplicate = await api(h, '/api/v1/auth/register', {
      method: 'POST',
      body: { name: 'Dup', email: 'dup@example.com', password: 'password123', storeName: 'Store' },
    });
    expect(duplicate.status).toBe(409);

    const short = await api(h, '/api/v1/auth/register', {
      method: 'POST',
      body: { name: 'A', email: 'a@example.com', password: 'short', storeName: 'Store' },
    });
    expect(short.status).toBe(400);
    expect((short.body as any).error.code).toBe('validation_error');

    const missing = await api(h, '/api/v1/auth/register', {
      method: 'POST',
      body: { email: 'b@example.com', password: 'password123' },
    });
    expect(missing.status).toBe(400);
  });

  it('rejects bad logins, bad refresh tokens and bad tokens on me', async () => {
    await register(h, { email: 'owner2@example.com' });

    const badLogin = await api(h, '/api/v1/auth/login', { method: 'POST', body: { email: 'owner2@example.com', password: 'wrong-password' } });
    expect(badLogin.status).toBe(401);

    const unknownLogin = await api(h, '/api/v1/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'password123' } });
    expect(unknownLogin.status).toBe(401);

    const badRefresh = await api(h, '/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: 'nope' } });
    expect(badRefresh.status).toBe(401);

    expect((await api(h, '/api/v1/auth/me', { token: 'garbage' })).status).toBe(401);
    expect((await api(h, '/api/v1/auth/me')).status).toBe(401);
  });

  it('supports access_token query authentication', async () => {
    const { token } = await register(h, { email: 'query@example.com' });
    const me = await api(h, `/api/v1/auth/me?access_token=${token}`);
    expect(me.status).toBe(200);
    expect((me.body as any).user.email).toBe('query@example.com');

    const bad = await api(h, '/api/v1/auth/me?access_token=garbage');
    expect(bad.status).toBe(401);
  });

  it('requests password reset for known and unknown emails', async () => {
    const reset = await api(h, '/api/v1/auth/reset-password', { method: 'POST', body: { email: 'anyone@example.com' } });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ resetRequested: true });
  });

  it('rejects body-less auth requests and empty query tokens', async () => {
    for (const path of ['/api/v1/auth/register', '/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/reset-password']) {
      const result = await api(h, path, { method: 'POST' });
      expect(result.status).toBe(400);
    }
    const emptyToken = await api(h, '/api/v1/auth/me?access_token=');
    expect(emptyToken.status).toBe(401);
  });
});

describe('dashboard + observability', () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    h = await newHarness();
    ({ token } = await register(h, { email: 'dash@example.com' }));
    await seedObservability(h);
  });
  afterEach(async () => {
    await stopQuietly(h);
  });

  it('serves dashboard overview and trends', async () => {
    const overview = await api(h, '/api/v1/dashboard/overview', { token });
    expect(overview.status).toBe(200);
    const body = overview.body as any;
    expect(body.overview).toBeDefined();
    expect(body.settings.storeName).toBe('My Store');
    expect(body.unreadNotifications).toBe(0);

    const scoped = await api(h, '/api/v1/dashboard/overview?storeId=store-1', { token });
    expect(scoped.status).toBe(200);

    const trends = await api(h, '/api/v1/dashboard/trends', { token });
    expect(trends.status).toBe(200);
    expect((trends.body as any).seo).toBeDefined();
    expect((trends.body as any).execution).toBeDefined();

    const limited = await api(h, '/api/v1/dashboard/trends?storeId=store-1&limit=2', { token });
    expect(limited.status).toBe(200);
  });

  it('serves observability overview, metrics, alerts and timeline', async () => {
    expect((await api(h, '/api/v1/observability/overview', { token })).status).toBe(200);
    expect((await api(h, '/api/v1/observability/metrics', { token })).status).toBe(200);

    const alerts = await api(h, '/api/v1/observability/alerts', { token });
    expect(alerts.status).toBe(200);
    const first = (alerts.body as any).alerts[0];
    expect(first.acknowledged).toBe(false);

    const ack = await api(h, '/api/v1/observability/alerts/alert_1/acknowledge', { method: 'POST', token, body: {} });
    expect(ack.status).toBe(200);
    expect(ack.body).toEqual({ alertId: 'alert_1', acknowledged: true });

    const afterAck = await api(h, '/api/v1/observability/alerts', { token });
    expect((afterAck.body as any).alerts[0].acknowledged).toBe(true);

    const unack = await api(h, '/api/v1/observability/alerts/alert_1/acknowledge', { method: 'POST', token, body: { acknowledged: false } });
    expect(unack.status).toBe(200);
    expect(unack.body).toEqual({ alertId: 'alert_1', acknowledged: false });

    const noBody = await api(h, '/api/v1/observability/alerts/alert_1/acknowledge', { method: 'POST', token });
    expect(noBody.status).toBe(200);
    expect(noBody.body).toEqual({ alertId: 'alert_1', acknowledged: true });

    const missing = await api(h, '/api/v1/observability/alerts/alert_nope/acknowledge', { method: 'POST', token, body: {} });
    expect(missing.status).toBe(404);

    const timeline = await api(h, '/api/v1/observability/timeline', { token });
    expect(timeline.status).toBe(200);
  });
});

describe('crawls, seo and executions', () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    h = await boot({ platform: createPlatform({ fetchImpl: crawlFetch as unknown as typeof fetch }) });
    ({ token } = await register(h, { email: 'crawl@example.com' }));
  });
  afterEach(async () => {
    await stopQuietly(h);
  });

  it('lists, creates, fetches and cancels crawl jobs', async () => {
    const empty = await api(h, '/api/v1/crawls', { token });
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ crawls: [] });

    seedCrawlJob(h, 'job_running', 'RUNNING');
    seedCrawlJob(h, 'job_pending', 'PENDING', { startedAt: null });

    const all = await api(h, '/api/v1/crawls', { token });
    expect((all.body as any).crawls).toHaveLength(2);

    const filtered = await api(h, '/api/v1/crawls?storeId=other', { token });
    expect((filtered.body as any).crawls).toHaveLength(0);

    const found = await api(h, '/api/v1/crawls/job_running', { token });
    expect(found.status).toBe(200);
    expect((found.body as any).crawl.status).toBe('running');

    const missing = await api(h, '/api/v1/crawls/job_nope', { token });
    expect(missing.status).toBe(404);

    const cancelled = await api(h, '/api/v1/crawls/job_running/cancel', { method: 'POST', token });
    expect(cancelled.status).toBe(200);
    expect((cancelled.body as any).crawl.status).toBe('cancelled');

    const again = await api(h, '/api/v1/crawls/job_running/cancel', { method: 'POST', token });
    expect(again.status).toBe(409);

    const unknown = await api(h, '/api/v1/crawls/job_nope/cancel', { method: 'POST', token });
    expect(unknown.status).toBe(404);
  });

  it('creates a crawl with explicit and default seeds, and validates input', async () => {
    const created = await api(h, '/api/v1/crawls', {
      method: 'POST',
      token,
      body: { storeId: 'store-1', seeds: ['https://store-1.myshopify.com/'] },
    });
    expect(created.status).toBe(201);
    const body = created.body as any;
    expect(body.crawl.storeId).toBe('store-1');
    expect(body.statistics).toBeDefined();

    const defaulted = await api(h, '/api/v1/crawls', { method: 'POST', token, body: { storeId: 'store-2' } });
    expect(defaulted.status).toBe(201);

    const noSeeds = await api(h, '/api/v1/crawls', { method: 'POST', token, body: { storeId: 'store-3', seeds: [] } });
    expect(noSeeds.status).toBe(500);

    const missing = await api(h, '/api/v1/crawls', { method: 'POST', token, body: {} });
    expect(missing.status).toBe(400);

    const noBody = await api(h, '/api/v1/crawls', { method: 'POST', token });
    expect(noBody.status).toBe(400);
  });

  it('handles unknown crawl statuses, empty snapshots and body-less mutations', async () => {
    seedCrawlJob(h, 'job_weird', 'UNKNOWN');
    const all = await api(h, '/api/v1/crawls', { token });
    const weird = (all.body as any).crawls.find((entry: any) => entry.id === 'job_weird');
    expect(weird.status).toBe('unknown');

    await h.platform.observabilityStore.appendSnapshot({
      snapshotId: 'snap_empty',
      storeId: 'store-1',
      capturedAt: '2026-01-15T13:00:00.000Z',
      overallScore: 90,
      pagesCrawled: 3,
      totalIssues: 0,
    });
    const recs = await api(h, '/api/v1/seo/recommendations?storeId=store-1', { token });
    expect((recs.body as any).recommendations).toEqual([]);

    const breakdown = await api(h, '/api/v1/seo/breakdown', { token });
    expect(breakdown.status).toBe(200);
    expect((breakdown.body as any).score).toBe(90);
    expect((breakdown.body as any).categories).toEqual([]);

    const missingRecs = await api(h, '/api/v1/seo/recommendations?storeId=missing-store', { token });
    expect((missingRecs.body as any).recommendations).toEqual([]);
    const missingBreakdown = await api(h, '/api/v1/seo/breakdown?storeId=missing-store', { token });
    expect((missingBreakdown.body as any).score).toBeNull();
    expect((missingBreakdown.body as any).categories).toEqual([]);

    const patchNoBody = await api(h, '/api/v1/seo/recommendations/rec_none', { method: 'PATCH', token });
    expect(patchNoBody.status).toBe(400);
  });

  it('reflects recommendation overrides in the list', async () => {
    await seedObservability(h);
    const recs = await api(h, '/api/v1/seo/recommendations?storeId=store-1', { token });
    const first = (recs.body as any).recommendations[0] as { id: string };
    await api(h, `/api/v1/seo/recommendations/${first.id}`, { method: 'PATCH', token, body: { status: 'resolved' } });
    const after = await api(h, '/api/v1/seo/recommendations?storeId=store-1', { token });
    const updated = (after.body as any).recommendations.find((entry: any) => entry.id === first.id);
    expect(updated.status).toBe('resolved');
  });

  it('serves SEO recommendations and breakdown, and updates recommendation status', async () => {
    const empty = await api(h, '/api/v1/seo/recommendations', { token });
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ recommendations: [] });

    await seedObservability(h);

    const recs = await api(h, '/api/v1/seo/recommendations?storeId=store-1', { token });
    expect(recs.status).toBe(200);
    const items = (recs.body as any).recommendations as Array<{ id: string; severity: string; score: number }>;
    expect(items).toHaveLength(3);
    const byScore = Object.fromEntries(items.map((item) => [item.score, item.severity]));
    expect(byScore['40']).toBe('high');
    expect(byScore['66']).toBe('medium');
    expect(byScore['85']).toBe('low');

    const patch = await api(h, `/api/v1/seo/recommendations/${items[0]!.id}`, {
      method: 'PATCH',
      token,
      body: { status: 'planned' },
    });
    expect(patch.status).toBe(200);
    expect(patch.body).toEqual({ id: items[0]!.id, status: 'planned' });

    const invalid = await api(h, `/api/v1/seo/recommendations/${items[0]!.id}`, {
      method: 'PATCH',
      token,
      body: { status: 'nonsense' },
    });
    expect(invalid.status).toBe(400);

    const breakdown = await api(h, '/api/v1/seo/breakdown?storeId=store-1', { token });
    expect(breakdown.status).toBe(200);
    expect((breakdown.body as any).score).toBe(61);
    expect((breakdown.body as any).categories).toHaveLength(3);

    const bareBreakdown = await api(h, '/api/v1/seo/breakdown?storeId=empty', { token });
    expect((bareBreakdown.body as any).score).toBeNull();
    expect((bareBreakdown.body as any).categories).toEqual([]);
  });

  it('lists executions, fetches one and applies lifecycle actions', async () => {
    await seedObservability(h);

    const list = await api(h, '/api/v1/executions?storeId=store-1', { token });
    expect(list.status).toBe(200);
    expect((list.body as any).executions).toHaveLength(2);

    const found = await api(h, '/api/v1/executions/ex_1', { token });
    expect(found.status).toBe(200);
    expect((found.body as any).execution.title).toBe('meta:title');

    const missing = await api(h, '/api/v1/executions/ex_nope', { token });
    expect(missing.status).toBe(404);

    for (const [action, status] of [
      ['approve', 'approved'],
      ['reject', 'cancelled'],
      ['rollback', 'rolled-back'],
      ['run', 'running'],
    ] as const) {
      const result = await api(h, `/api/v1/executions/ex_1/${action}`, { method: 'POST', token });
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ id: 'ex_1', status, action });
    }

    const unknownAction = await api(h, '/api/v1/executions/ex_nope/approve', { method: 'POST', token });
    expect(unknownAction.status).toBe(404);
  });

  it('fills fallback fields for minimal executions and surfaces overrides', async () => {
    await h.platform.observabilityStore.upsertExecution({
      executionId: 'ex_min',
      storeId: 'store-1',
      status: 'EXECUTING',
      startedAt: FIXED_NOW,
    });
    await seedObservability(h);

    const list = await api(h, '/api/v1/executions', { token });
    expect(list.status).toBe(200);
    const minimal = (list.body as any).executions.find((entry: any) => entry.id === 'ex_min');
    expect(minimal.title).toBe('Execution');
    expect(minimal.changes).toBe(0);
    expect(minimal.createdBy).toBe('system');
    expect(minimal.completedAt).toBeUndefined();

    const found = await api(h, '/api/v1/executions/ex_min', { token });
    expect(found.status).toBe(200);
    expect((found.body as any).execution.title).toBe('Execution');
    expect((found.body as any).execution.completedAt).toBeUndefined();

    await api(h, '/api/v1/executions/ex_1/approve', { method: 'POST', token });
    const after = await api(h, '/api/v1/executions', { token });
    const approved = (after.body as any).executions.find((entry: any) => entry.id === 'ex_1');
    expect(approved.status).toBe('approved');

    const detail = await api(h, '/api/v1/executions/ex_1', { token });
    expect((detail.body as any).execution.status).toBe('approved');
  });
});

describe('reports', () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    h = await newHarness();
    ({ token } = await register(h, { email: 'reports@example.com' }));
  });
  afterEach(async () => {
    await stopQuietly(h);
  });

  it('lists, generates and fetches reports', async () => {
    const empty = await api(h, '/api/v1/reports', { token });
    expect(empty.body).toEqual({ reports: [] });

    const created = await api(h, '/api/v1/reports', { method: 'POST', token, body: { kind: 'seo', storeId: 'store-1', days: 7, compare: true } });
    expect(created.status).toBe(201);
    const report = (created.body as any).report;
    expect(report.kind).toBe('seo');

    const list = await api(h, '/api/v1/reports', { token });
    expect((list.body as any).reports).toHaveLength(1);

    const found = await api(h, `/api/v1/reports/${report.id}`, { token });
    expect(found.status).toBe(200);
    expect((found.body as any).report.id).toBe(report.id);

    const missing = await api(h, '/api/v1/reports/report_nope', { token });
    expect(missing.status).toBe(404);

    const invalidKind = await api(h, '/api/v1/reports', { method: 'POST', token, body: { kind: 'nonsense' } });
    expect(invalidKind.status).toBe(400);

    const noBody = await api(h, '/api/v1/reports', { method: 'POST', token });
    expect(noBody.status).toBe(400);
  });
});

describe('copilot', () => {
  it('lists sessions and streams a conversation as SSE', async () => {
    const h = await newHarness();
    try {
      const { token } = await register(h, { email: 'copilot@example.com' });

      const sessions = await api(h, '/api/v1/copilot/sessions', { token });
      expect(sessions.status).toBe(200);
      expect((sessions.body as any).sessions).toEqual([]);

      const scoped = await api(h, '/api/v1/copilot/sessions?storeId=store-1', { token });
      expect(scoped.status).toBe(200);

      const response = await fetch(`${h.baseUrl}/api/v1/copilot/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: 'How is my SEO doing?', storeId: 'store-1', temperature: 0.7 }),
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('data: {"type":"start"}');
      expect(text).toContain('"type":"delta"');
      expect(text).toContain('"type":"done"');

      const after = await api(h, '/api/v1/copilot/sessions', { token });
      expect((after.body as any).sessions).toHaveLength(1);

      const noBody = await api(h, '/api/v1/copilot/chat', { method: 'POST', token });
      expect(noBody.status).toBe(400);
    } finally {
      await stopQuietly(h);
    }
  });

  it('streams tool-call and tool-result events', async () => {
    const h = await boot({ platform: createPlatform({ model: toolModel }) });
    try {
      const { token } = await register(h, { email: 'tools@example.com' });
      const response = await fetch(`${h.baseUrl}/api/v1/copilot/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: 'Run the tools please' }),
      });
      const text = await response.text();
      expect(text).toContain('"type":"tool-call"');
      expect(text).toContain('"type":"tool-result"');
      expect(text).toContain('"type":"done"');
    } finally {
      await stopQuietly(h);
    }
  });

  it('emits an SSE error event when the model fails', async () => {
    const h = await boot({ platform: createPlatform({ model: throwingModel }) });
    try {
      const { token } = await register(h, { email: 'errors@example.com' });
      const response = await fetch(`${h.baseUrl}/api/v1/copilot/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: 'Please fail' }),
      });
      const text = await response.text();
      expect(text).toContain('"type":"error"');
      expect(text).toContain('model exploded');
    } finally {
      await stopQuietly(h);
    }
  });

  it('handles non-Error model failures with a generic message', async () => {
    const h = await boot({ platform: createPlatform({ model: throwingValue }) });
    try {
      const { token } = await register(h, { email: 'errors2@example.com' });
      const response = await fetch(`${h.baseUrl}/api/v1/copilot/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: 'Please fail' }),
      });
      const text = await response.text();
      expect(text).toContain('"type":"error"');
      expect(text).toContain('Chat model failed.');
    } finally {
      await stopQuietly(h);
    }
  });
});

describe('admin', () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    h = await newHarness();
    ({ token } = await register(h, { email: 'admin@example.com' }));
  });
  afterEach(async () => {
    await stopQuietly(h);
  });

  it('lists and provisions tenants, orgs, teams and members', async () => {
    const tenants = await api(h, '/api/v1/admin/tenants', { token });
    expect((tenants.body as any).tenants).toHaveLength(1);

    const created = await api(h, '/api/v1/admin/tenants', { method: 'POST', token, body: { name: 'Second Co' } });
    expect(created.status).toBe(201);
    expect((created.body as any).tenant.name).toBe('Second Co');

    const orgs = await api(h, '/api/v1/admin/orgs', { token });
    expect((orgs.body as any).orgs).toHaveLength(1);

    const teams = await api(h, '/api/v1/admin/teams', { token });
    expect((teams.body as any).teams).toEqual([]);

    const teamsScoped = await api(h, `/api/v1/admin/teams?organizationId=${(orgs.body as any).orgs[0].id}`, { token });
    expect(teamsScoped.status).toBe(200);

    const members = await api(h, '/api/v1/admin/members', { token });
    expect((members.body as any).members).toHaveLength(1);

    const invite = await api(h, '/api/v1/admin/members/invite', {
      method: 'POST',
      token,
      body: { email: 'jo@example.com', role: 'member', name: 'Jo' },
    });
    expect(invite.status).toBe(201);

    const afterInvite = await api(h, '/api/v1/admin/members', { token });
    const invited = (afterInvite.body as any).members.find((member: any) => member.email === 'jo@example.com');
    expect(invited.role).toBe('member');

    const promote = await api(h, `/api/v1/admin/members/${invited.id}/role`, { method: 'PATCH', token, body: { role: 'admin' } });
    expect(promote.status).toBe(200);
    expect((promote.body as any).member.role).toBe('admin');

    const unknownRole = await api(h, '/api/v1/admin/members/nobody/role', { method: 'PATCH', token, body: { role: 'admin' } });
    expect(unknownRole.status).toBe(404);

    const badInvite = await api(h, '/api/v1/admin/members/invite', {
      method: 'POST',
      token,
      body: { email: 'not-an-email', role: 'member' },
    });
    expect(badInvite.status).toBe(400);

    const badRole = await api(h, '/api/v1/admin/members/invite', {
      method: 'POST',
      token,
      body: { email: 'x@example.com', role: 'superuser' },
    });
    expect(badRole.status).toBe(400);
  });

  it('queries the audit log', async () => {
    const all = await api(h, '/api/v1/admin/audit', { token });
    expect(all.status).toBe(200);
    expect((all.body as any).entries.length).toBeGreaterThan(0);

    const filtered = await api(h, '/api/v1/admin/audit?action=auth.register', { token });
    expect((filtered.body as any).entries.length).toBeGreaterThan(0);

    const limited = await api(h, '/api/v1/admin/audit?limit=1', { token });
    expect((limited.body as any).entries).toHaveLength(1);
  });

  it('issues, lists, uses and revokes API keys', async () => {
    const issued = await api(h, '/api/v1/admin/api-keys', {
      method: 'POST',
      token,
      body: { label: 'CI', scopes: 'orgs.read,audit.read', expiresInDays: 30 },
    });
    expect(issued.status).toBe(201);
    const apiKey = (issued.body as any).apiKey;
    expect(apiKey.key).toMatch(/^sk_seogod_[a-z0-9_-]+$/i);
    expect(apiKey.scopes).toEqual(['orgs.read', 'audit.read']);
    expect(apiKey.enabled).toBe(true);

    const list = await api(h, '/api/v1/admin/api-keys', { token });
    expect((list.body as any).apiKeys).toHaveLength(1);

    const viaKey = await api(h, '/api/v1/admin/orgs', { apiKey: apiKey.key });
    expect(viaKey.status).toBe(200);

    const viaAuditKey = await api(h, '/api/v1/admin/audit', { apiKey: apiKey.key });
    expect(viaAuditKey.status).toBe(200);

    const badKey = await api(h, '/api/v1/admin/orgs', { apiKey: 'invalid-key-value' });
    expect(badKey.status).toBe(401);

    const restricted = await api(h, '/api/v1/admin/api-keys', {
      method: 'POST',
      token,
      body: { label: 'Readonly', scopes: 'tenant.read' },
    });
    const readonlyKey = (restricted.body as any).apiKey.key;
    const denied = await api(h, '/api/v1/admin/orgs', { apiKey: readonlyKey });
    expect(denied.status).toBe(403);

    const revoked = await api(h, `/api/v1/admin/api-keys/${apiKey.id}`, { method: 'DELETE', token });
    expect(revoked.status).toBe(200);
    expect((revoked.body as any).apiKey.enabled).toBe(false);

    const afterRevoke = await api(h, '/api/v1/admin/orgs', { apiKey: apiKey.key });
    expect(afterRevoke.status).toBe(401);
  });

  it('serves billing entitlements', async () => {
    const billing = await api(h, '/api/v1/admin/billing', { token });
    expect(billing.status).toBe(200);
    const body = billing.body as any;
    expect(body.plan).toBe('free');
    expect(typeof body.seats).toBe('number');
    expect(body.nextBillingAt).toBeUndefined();
  });

  it('manages webhook endpoints and deliveries', async () => {
    const empty = await api(h, '/api/v1/admin/webhooks', { token });
    expect(empty.body).toEqual({ webhooks: [] });

    const created = await api(h, '/api/v1/admin/webhooks', {
      method: 'POST',
      token,
      body: { url: 'https://example.com/hook', events: ['store.updated'] },
    });
    expect(created.status).toBe(201);
    const webhook = (created.body as any).webhook;
    expect(webhook.events).toEqual(['store.updated']);

    const defaulted = await api(h, '/api/v1/admin/webhooks', {
      method: 'POST',
      token,
      body: { url: 'https://example.com/hook2' },
    });
    expect((defaulted.body as any).webhook.events).toEqual(['store.updated']);

    const patched = await api(h, `/api/v1/admin/webhooks/${webhook.id}`, {
      method: 'PATCH',
      token,
      body: { enabled: false, description: 'off' },
    });
    expect(patched.status).toBe(200);
    expect((patched.body as any).webhook.enabled).toBe(false);

    const patchMissing = await api(h, '/api/v1/admin/webhooks/w_nope', { method: 'PATCH', token, body: { enabled: true } });
    expect(patchMissing.status).toBe(404);

    const tested = await api(h, `/api/v1/admin/webhooks/${webhook.id}/test`, {
      method: 'POST',
      token,
      body: { type: 'store.updated', payload: { ok: true } },
    });
    expect(tested.status).toBe(200);
    expect((tested.body as any).delivered).toBe(true);

    const testMissing = await api(h, '/api/v1/admin/webhooks/w_nope/test', { method: 'POST', token, body: {} });
    expect(testMissing.status).toBe(404);

    const deliveries = await api(h, '/api/v1/admin/webhooks/deliveries', { token });
    expect(deliveries.status).toBe(200);

    const deleted = await api(h, `/api/v1/admin/webhooks/${webhook.id}`, { method: 'DELETE', token });
    expect(deleted.status).toBe(204);

    const deleteMissing = await api(h, '/api/v1/admin/webhooks/w_nope', { method: 'DELETE', token });
    expect(deleteMissing.status).toBe(404);

    const createMissingUrl = await api(h, '/api/v1/admin/webhooks', { method: 'POST', token, body: {} });
    expect(createMissingUrl.status).toBe(400);

    const createNoBody = await api(h, '/api/v1/admin/webhooks', { method: 'POST', token });
    expect(createNoBody.status).toBe(400);
  });

  it('provisions tenants, teams and invites without names', async () => {
    const noBody = await api(h, '/api/v1/admin/tenants', { method: 'POST', token });
    expect(noBody.status).toBe(400);

    const { session, token: ownToken } = await register(h, { email: 'teamowner@example.com' });
    const tenantId = (session as any).user.tenantId as string;
    const organization = (await h.platform.enterprise.orgs.listOrganizations(tenantId))[0]!;
    const team = await h.platform.enterprise.orgs.createTeam(tenantId, organization.organizationId, 'Platform');
    await h.platform.enterprise.orgs.addTeamMember(tenantId, team.teamId, (session as any).user.id as string, 'owner');

    const teams = await api(h, '/api/v1/admin/teams', { token: ownToken });
    expect(teams.status).toBe(200);
    expect((teams.body as any).teams).toHaveLength(1);
    expect((teams.body as any).teams[0].memberCount).toBe(1);

    const invited = await api(h, '/api/v1/admin/members/invite', {
      method: 'POST',
      token: ownToken,
      body: { email: 'nameless@example.com', role: 'member' },
    });
    expect(invited.status).toBe(201);
    expect((invited.body as any).member.name).toBe('nameless@example.com');
  });

  it('returns 404 when inviting into a tenant without organizations', async () => {
    const { session, token: orphanToken } = await register(h, { email: 'orphan@example.com' });
    const tenantId = (session as any).user.tenantId as string;
    const organization = (await h.platform.enterprise.orgs.listOrganizations(tenantId))[0]!;
    await h.platform.enterprise.orgs.removeOrganization(tenantId, organization.organizationId);

    const invite = await api(h, '/api/v1/admin/members/invite', {
      method: 'POST',
      token: orphanToken,
      body: { email: 'lonely@example.com', role: 'member' },
    });
    expect(invite.status).toBe(404);
  });

  it('defaults api-key scopes and attributes keys to the issuing principal', async () => {
    const defaulted = await api(h, '/api/v1/admin/api-keys', { method: 'POST', token, body: { label: 'DefaultScope' } });
    expect(defaulted.status).toBe(201);
    expect((defaulted.body as any).apiKey.scopes).toEqual(['tenant.read']);

    const parent = await api(h, '/api/v1/admin/api-keys', { method: 'POST', token, body: { label: 'Parent', scopes: 'apikeys.manage' } });
    const parentKey = (parent.body as any).apiKey.key as string;

    const child = await api(h, '/api/v1/admin/api-keys', { method: 'POST', apiKey: parentKey, body: { label: 'Child' } });
    expect(child.status).toBe(201);
    expect((child.body as any).apiKey.scopes).toEqual(['tenant.read']);
  });

  it('reports subscribed billing entitlements', async () => {
    const { session, token: billingToken } = await register(h, { email: 'billing@example.com' });
    await h.platform.enterprise.billing.subscribe((session as any).user.tenantId as string, 'pro');

    const billing = await api(h, '/api/v1/admin/billing', { token: billingToken });
    expect(billing.status).toBe(200);
    expect((billing.body as any).plan).toBe('pro');
    expect(typeof (billing.body as any).nextBillingAt).toBe('number');
  });

  it('exposes failure outcomes in the audit log', async () => {
    const { session, token: auditToken } = await register(h, { email: 'auditfail@example.com' });
    h.platform.enterprise.audit.record({
      tenantId: (session as any).user.tenantId as string,
      actorId: 'system',
      actorType: 'system',
      action: 'custom.failed',
      resourceType: 'org',
      resourceId: 'org-1',
      metadata: { outcome: 'failure' },
    });

    const all = await api(h, '/api/v1/admin/audit', { token: auditToken });
    const entry = (all.body as any).entries.find((candidate: any) => candidate.action === 'custom.failed');
    expect(entry.outcome).toBe('failure');
  });

  it('patches webhooks with partial fields and tests default payloads', async () => {
    const created = await api(h, '/api/v1/admin/webhooks', {
      method: 'POST',
      token,
      body: { url: 'https://example.com/patch-hook' },
    });
    const webhook = (created.body as any).webhook;

    const emptyPatch = await api(h, `/api/v1/admin/webhooks/${webhook.id}`, { method: 'PATCH', token });
    expect(emptyPatch.status).toBe(200);

    const urlOnly = await api(h, `/api/v1/admin/webhooks/${webhook.id}`, { method: 'PATCH', token, body: { url: 'https://example.com/patch-hook-2' } });
    expect(urlOnly.status).toBe(200);
    expect((urlOnly.body as any).webhook.url).toBe('https://example.com/patch-hook-2');

    const withEvents = await api(h, `/api/v1/admin/webhooks/${webhook.id}`, { method: 'PATCH', token, body: { events: ['store.deleted'] } });
    expect(withEvents.status).toBe(200);
    expect((withEvents.body as any).webhook.events).toEqual(['store.deleted']);

    const bare = await api(h, `/api/v1/admin/webhooks/${webhook.id}/test`, { method: 'POST', token });
    expect(bare.status).toBe(200);
    expect((bare.body as any).delivered).toBe(true);

    const nonObject = await api(h, `/api/v1/admin/webhooks/${webhook.id}/test`, { method: 'POST', token, body: { payload: 'string' } });
    expect(nonObject.status).toBe(200);
    expect((nonObject.body as any).delivered).toBe(true);
  });
});

describe('plugins', () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    h = await newHarness();
    ({ token } = await register(h, { email: 'plugins@example.com' }));
  });
  afterEach(async () => {
    await stopQuietly(h);
  });

  function bundle(version = '1.0.0', id = 'hello.plugin', name = 'Hello Plugin') {
    return {
      manifest: {
        schemaVersion: 1,
        id,
        name,
        version,
        permissions: ['plugin.tools.execute', 'plugin.analyzers.run', 'plugin.execution.actions'],
        contributions: {
          tools: [{ id: 'greet', name: 'Greet' }],
          analyzers: [{ id: 'titleCheck', name: 'Title Check' }],
          executionActions: [{ id: 'publish', name: 'Publish' }],
        },
      },
      code: `(function () { return {
        contributions: {
          tools: { greet: function (args) { return { greeting: 'hello ' + String(args.name) }; } },
          analyzers: { titleCheck: function (context) { return { score: context.storeId === 's1' ? 90 : 10, issues: [], recommendations: [] }; } },
          executionActions: { publish: function (input) { return { ok: true, output: { action: input.action } }; } },
        },
      }; })()`,
    };
  }

  it('installs, lists, executes and uninstalls plugins', async () => {
    const installed = await api(h, '/api/v1/admin/plugins', { method: 'POST', token, body: bundle() });
    expect(installed.status).toBe(201);
    expect((installed.body as any).plugin.id).toBe('hello.plugin');
    expect((installed.body as any).plugin.state).toBe('installed');

    const listed = await api(h, '/api/v1/admin/plugins', { token });
    expect(listed.status).toBe(200);
    expect((listed.body as any).plugins.map((plugin: any) => plugin.id)).toContain('hello.plugin');

    const fetched = await api(h, '/api/v1/admin/plugins/hello.plugin', { token });
    expect(fetched.status).toBe(200);
    expect((fetched.body as any).plugin.version).toBe('1.0.0');

    const enabled = await api(h, '/api/v1/admin/plugins/hello.plugin/enable', { method: 'POST', token });
    expect(enabled.status).toBe(200);
    expect((enabled.body as any).plugin.state).toBe('enabled');

    const tool = await api(h, '/api/v1/admin/plugins/dispatch/tools/greet', {
      method: 'POST',
      token,
      body: { args: { name: 'world' } },
    });
    expect(tool.status).toBe(200);
    expect((tool.body as any).result).toEqual({ greeting: 'hello world' });

    const analyzer = await api(h, '/api/v1/admin/plugins/dispatch/analyzers/titleCheck', {
      method: 'POST',
      token,
      body: { context: { storeId: 's1' } },
    });
    expect(analyzer.status).toBe(200);
    expect((analyzer.body as any).analyzer.score).toBe(90);

    const action = await api(h, '/api/v1/admin/plugins/dispatch/actions/publish', {
      method: 'POST',
      token,
      body: { action: 'publish', payload: { channel: 'c' } },
    });
    expect(action.status).toBe(200);
    expect((action.body as any).result.ok).toBe(true);

    const updated = await api(h, '/api/v1/admin/plugins/hello.plugin', {
      method: 'PUT',
      token,
      body: bundle('1.1.0'),
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).plugin.version).toBe('1.1.0');

    const disabled = await api(h, '/api/v1/admin/plugins/hello.plugin/disable', { method: 'POST', token });
    expect(disabled.status).toBe(200);
    expect((disabled.body as any).plugin.state).toBe('disabled');

    const blocked = await api(h, '/api/v1/admin/plugins/dispatch/tools/greet', {
      method: 'POST',
      token,
      body: { args: { name: 'world' } },
    });
    expect(blocked.status).toBe(404);

    const removed = await api(h, '/api/v1/admin/plugins/hello.plugin', { method: 'DELETE', token });
    expect(removed.status).toBe(200);

    const missing = await api(h, '/api/v1/admin/plugins/hello.plugin', { token });
    expect(missing.status).toBe(404);
  });

  it('rejects malformed bundles and duplicate installs', async () => {
    const noCode = await api(h, '/api/v1/admin/plugins', { method: 'POST', token, body: { manifest: bundle().manifest } });
    expect(noCode.status).toBe(400);

    const noBody = await api(h, '/api/v1/admin/plugins', { method: 'POST', token });
    expect(noBody.status).toBe(400);

    const badManifest = await api(h, '/api/v1/admin/plugins', { method: 'POST', token, body: { manifest: 'not-an-object', code: bundle().code } });
    expect(badManifest.status).toBe(400);

    const noBodyUpdate = await api(h, '/api/v1/admin/plugins/hello.plugin', { method: 'PUT', token });
    expect(noBodyUpdate.status).toBe(400);

    const invalidManifest = await api(h, '/api/v1/admin/plugins', { method: 'POST', token, body: bundle('not.a.version') });
    expect(invalidManifest.status).toBe(400);
    expect((invalidManifest.body as any).error.code).toBe('plugin_error');

    const first = await api(h, '/api/v1/admin/plugins', { method: 'POST', token, body: bundle() });
    expect(first.status).toBe(201);

    const duplicate = await api(h, '/api/v1/admin/plugins', { method: 'POST', token, body: bundle() });
    expect(duplicate.status).toBe(409);
  });

  it('rejects dispatch to unknown contributions and requires the action field', async () => {
    await api(h, '/api/v1/admin/plugins', { method: 'POST', token, body: bundle() });
    await api(h, '/api/v1/admin/plugins/hello.plugin/enable', { method: 'POST', token });

    const unknownTool = await api(h, '/api/v1/admin/plugins/dispatch/tools/nope', { method: 'POST', token, body: { args: {} } });
    expect(unknownTool.status).toBe(404);

    const bareTool = await api(h, '/api/v1/admin/plugins/dispatch/tools/greet', { method: 'POST', token });
    expect(bareTool.status).toBe(200);
    expect((bareTool.body as any).result).toEqual({ greeting: 'hello undefined' });

    const bareAnalyzer = await api(h, '/api/v1/admin/plugins/dispatch/analyzers/titleCheck', { method: 'POST', token });
    expect(bareAnalyzer.status).toBe(200);

    const missingAction = await api(h, '/api/v1/admin/plugins/dispatch/actions/publish', { method: 'POST', token, body: { payload: {} } });
    expect(missingAction.status).toBe(400);
  });

  it('denies plugin admin to callers without plugins permissions', async () => {
    const h = await newHarness();
    try {
      const { session, token } = await register(h, { email: 'denyplugins@example.com' });

      const viewer = await api(h, `/api/v1/admin/members/${session.user.id}/role`, {
        method: 'PATCH',
        token,
        body: { role: 'viewer' },
      });
      expect(viewer.status).toBe(200);

      const denied = await api(h, '/api/v1/admin/plugins', { token });
      expect(denied.status).toBe(403);
      expect((denied.body as any).error.code).toBe('forbidden');

      const noToken = await api(h, '/api/v1/admin/plugins', {});
      expect(noToken.status).toBe(401);
    } finally {
      await stopQuietly(h);
    }
  });
});

describe('settings and notifications', () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    h = await newHarness();
    ({ token } = await register(h, { email: 'settings@example.com' }));
  });
  afterEach(async () => {
    await stopQuietly(h);
  });

  it('reads and updates workspace settings and profile', async () => {
    const read = await api(h, '/api/v1/settings', { token });
    expect(read.status).toBe(200);
    expect((read.body as any).settings.storeName).toBe('My Store');

    const updated = await api(h, '/api/v1/settings', {
      method: 'PUT',
      token,
      body: { storeName: 'Renamed', notificationsEnabled: false, requireApproval: false, theme: 'dark', ignored: 1 },
    });
    expect(updated.status).toBe(200);
    const settings = (updated.body as any).settings;
    expect(settings.storeName).toBe('Renamed');
    expect(settings.notificationsEnabled).toBe(false);
    expect(settings.requireApproval).toBe(false);
    expect(settings.theme).toBe('dark');
    expect(settings.ignored).toBeUndefined();

    const profile = await api(h, '/api/v1/settings/profile', {
      method: 'PATCH',
      token,
      body: { locale: 'fr', theme: 'light' },
    });
    expect(profile.status).toBe(200);
    expect((profile.body as any).profile.locale).toBe('fr');
  });

  it('coerces invalid setting values and accepts body-less updates', async () => {
    const updated = await api(h, '/api/v1/settings', {
      method: 'PUT',
      token,
      body: { notificationsEnabled: 'yes', requireApproval: 1, theme: 42, locale: 'de' },
    });
    expect(updated.status).toBe(200);
    const settings = (updated.body as any).settings;
    expect(settings.notificationsEnabled).toBe(false);
    expect(settings.requireApproval).toBe(false);
    expect(settings.theme).toBe('');
    expect(settings.locale).toBe('de');

    const bare = await api(h, '/api/v1/settings', { method: 'PUT', token });
    expect(bare.status).toBe(200);
    expect((bare.body as any).settings.storeName).toBe('My Store');

    const bareProfile = await api(h, '/api/v1/settings/profile', { method: 'PATCH', token });
    expect(bareProfile.status).toBe(200);
  });

  it('updates the profile when authenticated as an api key', async () => {
    const issued = await api(h, '/api/v1/admin/api-keys', { method: 'POST', token, body: { label: 'SettingsKey', scopes: 'tenant.write' } });
    const apiKey = (issued.body as any).apiKey.key as string;

    const profile = await api(h, '/api/v1/settings/profile', { method: 'PATCH', apiKey, body: { theme: 'compact' } });
    expect(profile.status).toBe(200);
    expect((profile.body as any).profile.theme).toBe('compact');
  });

  it('lists, creates, marks read and marks all read notifications', async () => {
    const empty = await api(h, '/api/v1/notifications', { token });
    expect(empty.body).toEqual({ notifications: [], unreadCount: 0 });

    const created = await api(h, '/api/v1/notifications', {
      method: 'POST',
      token,
      body: { type: 'alert', title: 'Outage', message: 'Something failed', severity: 'critical' },
    });
    expect(created.status).toBe(201);
    const notification = (created.body as any).notification;
    expect(notification.read).toBe(false);

    const listed = await api(h, '/api/v1/notifications', { token });
    expect((listed.body as any).unreadCount).toBe(1);

    const marked = await api(h, `/api/v1/notifications/${notification.id}/read`, { method: 'POST', token });
    expect(marked.status).toBe(200);
    expect((marked.body as any).notification.read).toBe(true);

    const missing = await api(h, '/api/v1/notifications/n_nope/read', { method: 'POST', token });
    expect(missing.status).toBe(404);

    const createdSecond = await api(h, '/api/v1/notifications', {
      method: 'POST',
      token,
      body: { type: 'alert', title: 'B', message: 'M' },
    });
    expect(createdSecond.status).toBe(201);

    const all = await api(h, '/api/v1/notifications/read-all', { method: 'POST', token });
    expect(all.status).toBe(200);
    expect((all.body as any).marked).toBe(1);

    const badSeverity = await api(h, '/api/v1/notifications', {
      method: 'POST',
      token,
      body: { type: 'x', title: 'T', message: 'M', severity: 'loud' },
    });
    expect(badSeverity.status).toBe(400);

    const missingField = await api(h, '/api/v1/notifications', { method: 'POST', token, body: { type: 'x' } });
    expect(missingField.status).toBe(400);

    const noBody = await api(h, '/api/v1/notifications', { method: 'POST', token });
    expect(noBody.status).toBe(400);
  });
});

describe('RBAC and permissions', () => {
  it('denies admin actions when the caller is demoted to viewer', async () => {
    const h = await newHarness();
    try {
      const { session, token } = await register(h, { email: 'demote@example.com' });

      const demoted = await api(h, `/api/v1/admin/members/${session.user.id}/role`, {
        method: 'PATCH',
        token,
        body: { role: 'viewer' },
      });
      expect(demoted.status).toBe(200);

      const denied = await api(h, '/api/v1/admin/orgs', { token });
      expect(denied.status).toBe(403);
      expect((denied.body as any).error.code).toBe('forbidden');

      const stillAllowed = await api(h, '/api/v1/dashboard/overview', { token });
      expect(stillAllowed.status).toBe(200);
    } finally {
      await stopQuietly(h);
    }
  });

  it('rejects write actions that require higher permissions', async () => {
    const h = await newHarness();
    try {
      const { session, token } = await register(h, { email: 'writes@example.com' });
      await api(h, `/api/v1/admin/members/${session.user.id}/role`, { method: 'PATCH', token, body: { role: 'viewer' } });

      const write = await api(h, '/api/v1/crawls', { method: 'POST', token, body: { storeId: 's' } });
      expect(write.status).toBe(403);
    } finally {
      await stopQuietly(h);
    }
  });
});

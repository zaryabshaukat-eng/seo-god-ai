/**
 * Unit tests for the platform composition root: the in-memory Prisma surface,
 * the decision/plan reader, the stub chat model, webhook delivery through the
 * platform fetch impl, and the platform lifecycle methods.
 */

import { describe, it, expect } from 'vitest';
import type { CrawlJob } from '@prisma/client';
import type { DecisionLike, ExecutionPlanLike } from '@seogod/reports';
import { ApiServer, createApiRouter, registerPlatformRoutes } from './server.js';
import { Router } from './router.js';
import { sendJson } from './http.js';
import { ConflictError, NotFoundError } from './errors.js';
import { FakeDb, InMemoryDecisionReader, Platform } from './platform.js';
import { createPlatform } from '../test/harness.js';

const NOW = '2026-01-15T12:00:00.000Z';

interface FakePage {
  id: string;
  url?: string | null;
  title?: string | null;
}

interface FakeOutboxEvent {
  id: string;
  type: string;
  status: string;
  attempts: number;
}

interface FakePrismaSurface {
  page: {
    upsert: (args: { where: { crawlJobId_url: { crawlJobId: string; url: string } }; update: Record<string, unknown>; create: Record<string, unknown> }) => Promise<FakePage>;
    count: (args: { where: { crawlJobId: string } }) => Promise<number>;
    findMany: (args: { where: { crawlJobId: string }; orderBy?: unknown; take?: number }) => Promise<FakePage[]>;
  };
  pageLink: { createMany: (args: { data: Array<Partial<{ pageId: string; url: string }>> }) => Promise<{ count: number }> };
  pageStructuredData: { createMany: (args: { data: Array<Partial<{ pageId: string; type: string }>> }) => Promise<{ count: number }> };
  seoIssue: { createMany: (args: { data: Array<Partial<{ pageId: string; type: string }>> }) => Promise<{ count: number }> };
  outboxEvent: {
    create: (args: { data: Partial<{ type: string; aggregateType: string | null; aggregateId: string | null; payload: unknown; nextAttemptAt: Date }> }) => Promise<FakeOutboxEvent>;
    findMany: (args: { where?: Record<string, unknown>; orderBy?: unknown; take?: number }) => Promise<FakeOutboxEvent[]>;
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
    update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<FakeOutboxEvent>;
  };
}

function fakePrisma(db: FakeDb): FakePrismaSurface {
  return db.prisma as unknown as FakePrismaSurface;
}

describe('FakeDb', () => {
  it('creates, reads and updates crawl jobs', async () => {
    const db = new FakeDb(() => new Date(NOW));
    const created = await db.prisma.crawlJob.create({ data: { storeId: 's1', seeds: ['https://a.test/'] } });
    expect(created.status).toBe('PENDING');
    expect(created.id).toBe('job-1');
    expect(created.seeds).toEqual(['https://a.test/']);

    const bare = await db.prisma.crawlJob.create({ data: { storeId: 's2' } });
    expect(bare.seeds).toBeNull();

    await expect(db.prisma.crawlJob.findUnique({ where: { id: created.id } })).resolves.toEqual(created);
    await expect(db.prisma.crawlJob.findUnique({ where: { id: 'nope' } })).resolves.toBeNull();

    await db.prisma.crawlJob.update({ where: { id: created.id }, data: { status: 'COMPLETED' } });
    expect(db.jobs.get(created.id)?.status).toBe('COMPLETED');
    await expect(db.prisma.crawlJob.update({ where: { id: 'nope' }, data: {} })).rejects.toThrow();
  });

  it('upserts pages, counts and lists them sorted and truncated', async () => {
    const db = new FakeDb(() => new Date(NOW));
    const prisma = fakePrisma(db);
    const first = await prisma.page.upsert({
      where: { crawlJobId_url: { crawlJobId: 'j1', url: 'https://b.test/' } },
      update: { title: 'x' },
      create: { title: 'x' },
    });
    expect(first.id).toBe('page-1');
    await prisma.page.upsert({
      where: { crawlJobId_url: { crawlJobId: 'j1', url: 'https://a.test/' } },
      update: { title: 'y' },
      create: { title: 'y' },
    });
    await prisma.page.upsert({
      where: { crawlJobId_url: { crawlJobId: 'j1', url: 'https://b.test/' } },
      update: { title: 'updated' },
      create: { title: 'updated' },
    });
    expect(db.pages.size).toBe(2);
    await expect(prisma.page.count({ where: { crawlJobId: 'j1' } })).resolves.toBe(2);
    await expect(prisma.page.count({ where: { crawlJobId: 'other' } })).resolves.toBe(0);

    const listed = await prisma.page.findMany({ where: { crawlJobId: 'j1' }, orderBy: { url: 'asc' }, take: 1 });
    expect(listed.map((page) => page.url)).toEqual(['https://a.test/']);
  });

  it('persists links, structured data and issues', async () => {
    const db = new FakeDb(() => new Date(NOW));
    const prisma = fakePrisma(db);
    await prisma.pageLink.createMany({ data: [{ pageId: 'p1', url: 'https://a.test/' }] });
    await prisma.pageStructuredData.createMany({ data: [{ pageId: 'p1', type: 'Product' }] });
    await prisma.seoIssue.createMany({ data: [{ pageId: 'p1', type: 'missing_title' }] });
    expect(db.links).toHaveLength(1);
    expect(db.structuredData).toHaveLength(1);
    expect(db.issues).toHaveLength(1);
  });

  it('creates, queries and updates outbox events', async () => {
    const db = new FakeDb(() => new Date(NOW));
    const prisma = fakePrisma(db);
    const evt = await prisma.outboxEvent.create({ data: { type: 'store.updated', nextAttemptAt: new Date(NOW) } });
    expect(evt.id).toBe('evt-1');
    await prisma.outboxEvent.create({
      data: { type: 'crawl.completed', aggregateType: 'crawl', aggregateId: 'c1', payload: { ok: true }, nextAttemptAt: new Date('2026-01-15T13:00:00.000Z') },
    });

    const due = await prisma.outboxEvent.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date('2026-01-16T00:00:00.000Z') } },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });
    expect(due).toHaveLength(1);
    expect(due[0]?.type).toBe('store.updated');

    await prisma.outboxEvent.updateMany({ where: { status: 'PENDING' }, data: { status: 'PROCESSING' } });
    const partial = await prisma.outboxEvent.updateMany({
      where: { id: { in: ['evt-1'] }, status: 'PROCESSING' },
      data: { attempts: 1 },
    });
    expect(partial.count).toBe(1);

    await prisma.outboxEvent.updateMany({ where: { id: { in: ['evt-1'] } }, data: { status: 'FAILED' } });
    const noMatch = await prisma.outboxEvent.updateMany({ where: { id: { in: ['missing'] } }, data: { attempts: 3 } });
    expect(noMatch.count).toBe(0);
    expect(db.outbox.find((row) => row.id === 'evt-1')?.status).toBe('FAILED');

    const skipped = await prisma.outboxEvent.updateMany({ where: { status: 'PENDING' }, data: { attempts: 9 } });
    expect(skipped.count).toBe(0);

    await prisma.outboxEvent.update({ where: { id: 'evt-1' }, data: { attempts: 2 } });
    const updated = db.outbox.find((row) => row.id === 'evt-1');
    expect(updated?.attempts).toBe(2);
    await expect(prisma.outboxEvent.update({ where: { id: 'nope' }, data: {} })).rejects.toThrow();
  });

  it('sorts pages without urls and crawl jobs without timestamps', async () => {
    const db = new FakeDb(() => new Date(NOW));
    const prisma = fakePrisma(db);
    db.pages.set('a|https://a.test/', { crawlJobId: 'j1', url: 'https://a.test/' } as never);
    db.pages.set('b|missing', { crawlJobId: 'j1' } as never);
    db.pages.set('c|missing2', { crawlJobId: 'j1' } as never);
    const pages = await prisma.page.findMany({ where: { crawlJobId: 'j1' } });
    expect(pages.length).toBe(3);
    expect(pages.map((page) => page.url).sort()).toEqual(['https://a.test/', undefined, undefined]);

    const platform = new Platform({ now: () => new Date(NOW) });
    platform.db.jobs.set('j-null', { id: 'j-null', createdAt: null } as unknown as CrawlJob);
    platform.db.jobs.set('j-null2', { id: 'j-null2', createdAt: null } as unknown as CrawlJob);
    platform.db.jobs.set('j-dated', { id: 'j-dated', createdAt: new Date(NOW) } as unknown as CrawlJob);
    const listed = platform.listCrawlJobs();
    expect(listed).toHaveLength(3);
    expect(listed[0]?.id).toBe('j-dated');
  });

  it('reset clears every collection', () => {
    const db = new FakeDb(() => new Date(NOW));
    void db.prisma;
    db.outbox.push({ id: 'e' } as (typeof db.outbox)[number]);
    db.jobs.set('j', {} as CrawlJob);
    db.reset();
    expect(db.outbox).toHaveLength(0);
    expect(db.jobs.size).toBe(0);
    expect(db.pages.size).toBe(0);
    expect(db.issues).toHaveLength(0);
  });
});

describe('InMemoryDecisionReader', () => {
  it('ingests and lists plans and decisions', async () => {
    const reader = new InMemoryDecisionReader();
    reader.ingestDecision({ id: 'd1', storeId: 's1' } as DecisionLike);
    reader.ingestPlan({ id: 'p1', storeId: 's1', tasks: [] } as unknown as ExecutionPlanLike);
    reader.ingestPlan({ id: 'p2', storeId: 's2', tasks: [] } as unknown as ExecutionPlanLike);

    await expect(reader.getDecision('d1')).resolves.toMatchObject({ id: 'd1' });
    await expect(reader.getDecision('nope')).resolves.toBeNull();
    await expect(reader.listPlans('s1')).resolves.toHaveLength(1);
    await expect(reader.listPlans(undefined)).resolves.toHaveLength(2);

    reader.reset();
    await expect(reader.getDecision('d1')).resolves.toBeNull();
    await expect(reader.listPlans()).resolves.toHaveLength(0);
  });
});

describe('Platform lifecycle', () => {
  it('applies default options when constructed bare', () => {
    const platform = new Platform({ now: () => new Date(NOW) });
    expect(platform.id()).toEqual(expect.any(String));
    expect(platform.now().toISOString()).toBe(NOW);
    expect(platform.config).toBeDefined();
    expect(platform.logger).toBeDefined();

    const bare = new Platform();
    expect(bare.now()).toEqual(expect.any(Date));
    expect(bare.config).toBeDefined();
    expect(bare.logger).toBeDefined();
  });

  it('runs crawls and exposes crawl job reads', async () => {
    const platform = createPlatform();
    const result = await platform.startCrawl('store-1', ['https://store-1.myshopify.com/']);
    await platform.startCrawl('store-2', ['https://store-2.myshopify.com/']);
    expect(result.crawlJobId).toEqual(expect.any(String));
    expect(platform.listCrawlJobs()).toHaveLength(2);
    const job = platform.getCrawlJob(result.crawlJobId);
    expect(job).not.toBeNull();
    expect(platform.getCrawlJob('nope')).toBeNull();
  });

  it('cancels runnable jobs and rejects finished or missing jobs', async () => {
    const platform = createPlatform();
    platform.db.jobs.set('j1', { id: 'j1', storeId: 's1', status: 'RUNNING' } as CrawlJob);
    expect(platform.cancelCrawl('j1').status).toBe('CANCELLED');

    platform.db.jobs.set('j2', { id: 'j2', storeId: 's1', status: 'COMPLETED' } as CrawlJob);
    expect(() => platform.cancelCrawl('j2')).toThrow(ConflictError);
    expect(() => platform.cancelCrawl('nope')).toThrow(NotFoundError);
  });

  it('generates and runs scheduled reports', async () => {
    const platform = createPlatform();
    const report = await platform.generateReport({ kind: 'seo', storeId: 's1', renderers: ['json'] });
    expect(report.id).toEqual(expect.any(String));
    const fromSchedule = await platform.runScheduledReports(new Date(NOW));
    expect(Array.isArray(fromSchedule)).toBe(true);
    await expect(platform.runScheduledReports()).resolves.toBeDefined();
  });

  it('processes pending events and reports health', async () => {
    const platform = createPlatform();
    await platform.eventBus.publish({ type: 'store.updated', aggregateId: 'a1', payload: { ok: true } });
    const processed = await platform.processEvents(10);
    expect(processed).toBeGreaterThanOrEqual(1);
    const report = await platform.health.check();
    expect(report.status).toBe('ok');
  });

  it('streams deterministic replies through the stub model', async () => {
    const platform = createPlatform();
    const events: Array<{ type: string }> = [];
    for await (const event of platform.copilot.stream({
      tenantId: 't1',
      userId: 'u1',
      role: 'owner',
      message: 'hello world',
    })) {
      events.push(event);
    }
    const types = events.map((event) => event.type);
    expect(types).toContain('delta');
    expect(types).toContain('done');
  });

  it('delivers webhooks through the platform fetch impl', async () => {
    const platform = createPlatform();
    const endpoint = platform.enterprise.webhooks.register('t1', {
      url: 'https://receiver.test/hook',
      events: ['store.updated'],
    });
    const result = await platform.enterprise.webhooks.deliver(
      endpoint,
      { id: 'e1', tenantId: 't1', type: 'store.updated', createdAt: NOW, payload: { ok: true } },
      { attempts: 1, backoffMs: 0 },
    );
    expect(result.delivered).toBe(true);
  });

  it('reset clears every owned store', async () => {
    const platform = createPlatform();
    await platform.startCrawl('store-1', ['https://store-1.myshopify.com/']);
    platform.notifications.create({ tenantId: 't1', type: 'alert', title: 'A', message: 'm' });
    platform.reportStore.set('r1', { id: 'r1' } as never);
    platform.executionStates.set('e1', { status: 'running' });

    await platform.reset();
    expect(platform.listCrawlJobs()).toHaveLength(0);
    expect(platform.notifications.list('t1')).toHaveLength(0);
    expect(platform.reportStore.size).toBe(0);
    expect(platform.executionStates.size).toBe(0);
    expect(platform.db.pages.size).toBe(0);
  });
});

describe('ApiServer infrastructure', () => {
  it('builds routers with and without an explicit realtime hub', () => {
    const platform = createPlatform();
    const router = new Router();
    const hub = registerPlatformRoutes(platform, router);
    expect(hub).toBeDefined();
    expect(router.list().length).toBeGreaterThan(0);

    const noRealtime = createApiRouter(platform);
    expect(noRealtime.list().length).toBeGreaterThan(0);
  });

  it('exposes the route table, starts once and reports the bound port', async () => {
    const platform = createPlatform();
    const server = new ApiServer(platform, { port: 0 });
    expect(server.routeTable.length).toBeGreaterThan(0);
    expect(server.boundPort).toBeUndefined();

    await server.start();
    await server.start();
    expect(server.boundPort).toEqual(expect.any(Number));
    await server.stop();
    expect(server.boundPort).toBeUndefined();
  });

  it('falls back to the configured app port when none is given', async () => {
    const platform = createPlatform();
    const server = new ApiServer(platform);
    expect(server.routeTable.length).toBeGreaterThan(0);
    expect(server.boundPort).toBeUndefined();
  });

  it('registers extra caller routes via options', async () => {
    const platform = createPlatform();
    const server = new ApiServer(platform, {
      port: 0,
      routes: (router) => {
        router.on('GET', '/api/v1/custom', async (ctx) => {
          sendJson(ctx.res, 200, { custom: true });
        });
      },
    });
    await server.start();
    try {
      const response = await fetch(`http://127.0.0.1:${server.boundPort}/api/v1/custom`);
      await expect(response.json()).resolves.toEqual({ custom: true });
    } finally {
      await server.stop();
    }
  });

  it('reports unhealthy on the ready endpoint when a check fails', async () => {
    const platform = createPlatform();
    platform.health.register('failing', () => {
      throw new Error('boom');
    });
    const server = new ApiServer(platform, { port: 0 });
    await server.start();
    try {
      const response = await fetch(`http://127.0.0.1:${server.boundPort}/ready`);
      expect(response.status).toBe(503);
    } finally {
      await server.stop();
    }
  });
});

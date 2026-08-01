import { describe, expect, it } from 'vitest';
import type { CrawlJob, PrismaClient } from '@prisma/client';
import { NotFoundError } from '@seogod/core';
import { CrawlJobRepository } from './crawl-job.repository.js';

function makeJob(overrides: Partial<CrawlJob> = {}): CrawlJob {
  return {
    id: 'job-1',
    storeId: 'store-1',
    status: 'PENDING',
    totalPages: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function makeFakePrisma(): { prisma: PrismaClient; jobs: Map<string, CrawlJob> } {
  const jobs = new Map<string, CrawlJob>();
  const prisma = {
    crawlJob: {
      create: async (args: { data: { storeId: string } }): Promise<CrawlJob> => {
        const job = makeJob({ id: `job-${jobs.size + 1}`, storeId: args.data.storeId });
        jobs.set(job.id, job);
        return job;
      },
      findUnique: async (args: { where: { id: string } }): Promise<CrawlJob | null> =>
        jobs.get(args.where.id) ?? null,
      update: async (args: {
        where: { id: string };
        data: Partial<CrawlJob>;
      }): Promise<CrawlJob> => {
        const existing = jobs.get(args.where.id);
        if (existing === undefined) throw new Error('Record not found');
        const updated = { ...existing, ...args.data };
        jobs.set(args.where.id, updated);
        return updated;
      },
      findMany: async (args: {
        where: { storeId: string };
        orderBy?: unknown;
        take?: number;
      }): Promise<CrawlJob[]> =>
        [...jobs.values()]
          .filter((job) => job.storeId === args.where.storeId)
          .slice(0, args.take),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, jobs };
}

describe('CrawlJobRepository', () => {
  it('creates a pending job for a store', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new CrawlJobRepository(prisma);
    const job = await repo.create({ storeId: 'store-1' });
    expect(job.storeId).toBe('store-1');
    expect(job.status).toBe('PENDING');
  });

  it('gets a job by id and null for unknown jobs', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new CrawlJobRepository(prisma);
    const created = await repo.create({ storeId: 'store-1' });
    expect((await repo.get(created.id))?.id).toBe(created.id);
    expect(await repo.get('nope')).toBeNull();
  });

  it('getOrThrow throws NotFoundError for unknown jobs', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new CrawlJobRepository(prisma);
    await expect(repo.getOrThrow('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('marks a job running', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new CrawlJobRepository(prisma);
    const created = await repo.create({ storeId: 'store-1' });
    const running = await repo.markRunning(created.id);
    expect(running.status).toBe('RUNNING');
    expect(running.startedAt).not.toBeNull();
  });

  it('marks a job finished with a total page count', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new CrawlJobRepository(prisma);
    const created = await repo.create({ storeId: 'store-1' });
    const finished = await repo.markFinished(created.id, 'COMPLETED', 42);
    expect(finished.status).toBe('COMPLETED');
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.totalPages).toBe(42);
  });

  it('lists recent jobs for a store', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new CrawlJobRepository(prisma);
    await repo.create({ storeId: 'store-1' });
    await repo.create({ storeId: 'store-1' });
    await repo.create({ storeId: 'store-2' });
    const recent = await repo.listRecent('store-1');
    expect(recent).toHaveLength(2);
  });
});

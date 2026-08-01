import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { SeoIssueRepository } from './seo-issue.repository.js';

function makeFakePrisma(): PrismaClient {
  let issues = 0;
  const prisma = {
    seoIssue: {
      createMany: async (args: {
        data: { pageId: string; rule: string }[];
      }): Promise<{ count: number }> => {
        issues += args.data.length;
        return { count: args.data.length };
      },
      count: async (args: { where: { pageId: string } }): Promise<number> => {
        void args;
        return issues;
      },
    },
  };
  return prisma as unknown as PrismaClient;
}

describe('SeoIssueRepository', () => {
  it('bulk-inserts issues and returns the row count', async () => {
    const repo = new SeoIssueRepository(makeFakePrisma());
    const count = await repo.createMany([
      { pageId: 'page-1', rule: 'missing_title' },
      { pageId: 'page-1', rule: 'short_meta_description', severity: 'HIGH', message: 'too short' },
    ]);
    expect(count).toBe(2);
  });

  it('returns zero and skips the database for an empty list', async () => {
    const repo = new SeoIssueRepository(makeFakePrisma());
    expect(await repo.createMany([])).toBe(0);
  });

  it('defaults severity to MEDIUM', async () => {
    const repo = new SeoIssueRepository(makeFakePrisma());
    expect(await repo.createMany([{ pageId: 'page-1', rule: 'dup_h1' }])).toBe(1);
  });

  it('counts issues for a page', async () => {
    const repo = new SeoIssueRepository(makeFakePrisma());
    await repo.createMany([{ pageId: 'page-1', rule: 'missing_title' }]);
    expect(await repo.countByPage('page-1')).toBe(1);
  });
});

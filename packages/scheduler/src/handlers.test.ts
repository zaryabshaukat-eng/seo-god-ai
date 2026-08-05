import { describe, expect, it, vi } from 'vitest';
import { SchedulerValidationError } from './errors.js';
import {
  analysisJobHandler,
  crawlJobHandler,
  executionJobHandler,
  JobHandlerRegistry,
} from './handlers.js';
import type { ScheduledJob } from './types.js';

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  const now = new Date('2026-01-05T10:00:00.000Z');
  return {
    id: 'job-1',
    kind: 'crawl',
    name: 'crawl-store',
    storeId: 'store-1',
    cron: null,
    timezone: null,
    priority: 'normal',
    payload: null,
    maxRetries: 3,
    retryBackoffMs: 30_000,
    timeoutMs: null,
    enabled: true,
    status: 'pending',
    attempts: 0,
    nextRunAt: now,
    lastRunAt: null,
    lastStatus: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    ...overrides,
  };
}

describe('JobHandlerRegistry', () => {
  it('registers, gets, lists and supports handlers', () => {
    const registry = new JobHandlerRegistry();
    expect(registry.supports('crawl')).toBe(false);
    expect(registry.get('crawl')).toBeNull();
    registry.register(crawlJobHandler(vi.fn()));
    expect(registry.supports('crawl')).toBe(true);
    expect(registry.get('crawl')).not.toBeNull();
    expect(registry.get('analysis')).toBeNull();
    expect(registry.list()).toHaveLength(1);
  });

  it('replaces a handler registered for the same kind', () => {
    const registry = new JobHandlerRegistry();
    registry.register(crawlJobHandler(vi.fn()));
    registry.register(crawlJobHandler(vi.fn()));
    expect(registry.list()).toHaveLength(1);
  });

  it('removes a handler', () => {
    const registry = new JobHandlerRegistry();
    registry.register(crawlJobHandler(vi.fn()));
    expect(registry.remove('crawl')).toBe(true);
    expect(registry.remove('crawl')).toBe(false);
    expect(registry.supports('crawl')).toBe(false);
  });
});

describe('crawlJobHandler', () => {
  it('passes a validated payload to the executor', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const handler = crawlJobHandler(execute);
    const result = await handler.execute({
      job: job(),
      payload: { storeId: 'store-1', seeds: ['https://a.example', 'https://b.example'] },
    });
    expect(result).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith({
      storeId: 'store-1',
      seeds: ['https://a.example', 'https://b.example'],
    });
  });

  it.each([
    ['null payload', job(), null, /requires a JSON payload/],
    ['array payload', job(), [] as unknown as Record<string, unknown>, /requires a JSON payload/],
    ['missing storeId', job(), { seeds: ['https://a.example'] }, /missing required field "storeId"/],
    ['missing seeds', job(), { storeId: 'store-1' }, /missing required field "seeds"/],
    ['empty storeId', job(), { storeId: '', seeds: ['x'] }, /non-empty string/],
    ['empty seeds', job(), { storeId: 'store-1', seeds: [] }, /non-empty array of strings/],
    ['non-string seeds', job(), { storeId: 'store-1', seeds: [1] }, /non-empty array of strings/],
  ])('%s throws SchedulerValidationError', async (_label, job, payload: Record<string, unknown> | null, message) => {
    const handler = crawlJobHandler(vi.fn());
    await expect(handler.execute({ job, payload })).rejects.toThrow(SchedulerValidationError);
    await expect(handler.execute({ job, payload })).rejects.toThrow(message);
  });
});

describe('analysisJobHandler', () => {
  it('passes storeId without a crawlJobId when absent', async () => {
    const execute = vi.fn().mockResolvedValue({ report: {} });
    const handler = analysisJobHandler(execute);
    await handler.execute({ job: job({ kind: 'analysis' }), payload: { storeId: 'store-1' } });
    expect(execute).toHaveBeenCalledWith({ storeId: 'store-1', crawlJobId: undefined });
  });

  it('passes a crawlJobId when present', async () => {
    const execute = vi.fn().mockResolvedValue({ report: {} });
    const handler = analysisJobHandler(execute);
    await handler.execute({
      job: job({ kind: 'analysis' }),
      payload: { storeId: 'store-1', crawlJobId: 'crawl-42' },
    });
    expect(execute).toHaveBeenCalledWith({ storeId: 'store-1', crawlJobId: 'crawl-42' });
  });

  it('rejects a missing storeId', async () => {
    const handler = analysisJobHandler(vi.fn());
    await expect(handler.execute({ job: job({ kind: 'analysis' }), payload: {} })).rejects.toThrow(
      SchedulerValidationError,
    );
  });
});

describe('executionJobHandler', () => {
  it('passes through the execution plan without a storeId', async () => {
    const execute = vi.fn().mockResolvedValue({ executionId: 'exec-1' });
    const handler = executionJobHandler(execute);
    const plan = { operations: [] };
    await handler.execute({ job: job({ kind: 'execution' }), payload: { executionPlan: plan } });
    expect(execute).toHaveBeenCalledWith({ storeId: undefined, executionPlan: plan });
  });

  it('passes a storeId when present', async () => {
    const execute = vi.fn().mockResolvedValue({ executionId: 'exec-1' });
    const handler = executionJobHandler(execute);
    await handler.execute({
      job: job({ kind: 'execution' }),
      payload: { executionPlan: { operations: [] }, storeId: 'store-9' },
    });
    expect(execute).toHaveBeenCalledWith({ storeId: 'store-9', executionPlan: { operations: [] } });
  });

  it('rejects a missing execution plan', async () => {
    const handler = executionJobHandler(vi.fn());
    await expect(
      handler.execute({ job: job({ kind: 'execution' }), payload: { storeId: 'store-1' } }),
    ).rejects.toThrow(/missing required field "executionPlan"/);
  });
});

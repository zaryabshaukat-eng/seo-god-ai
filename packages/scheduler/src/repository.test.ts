import { describe, expect, it } from 'vitest';
import { MemoryJobRepository } from './repository.js';
import type { JobRun, ScheduledJob } from './types.js';

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
    payload: { seeds: ['https://example.com'] },
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

function run(overrides: Partial<JobRun> = {}): JobRun {
  const now = new Date('2026-01-05T10:00:00.000Z');
  return {
    id: 'run-1',
    jobId: 'job-1',
    status: 'running',
    attempt: 1,
    scheduledFor: now,
    startedAt: now,
    finishedAt: null,
    error: null,
    result: null,
    lockOwner: 'instance-1',
    ...overrides,
  };
}

describe('MemoryJobRepository', () => {
  it('saves and retrieves a job', async () => {
    const repo = new MemoryJobRepository();
    const stored = job();
    await repo.save(stored);
    const loaded = await repo.get('job-1');
    expect(loaded).toEqual(stored);
    expect(await repo.get('missing')).toBeNull();
  });

  it('returns copies, not internal references', async () => {
    const repo = new MemoryJobRepository();
    await repo.save(job());
    const loaded = (await repo.get('job-1'))!;
    loaded.name = 'mutated';
    expect((await repo.get('job-1'))!.name).toBe('crawl-store');
  });

  it('updates a job and returns the stored copy', async () => {
    const repo = new MemoryJobRepository();
    await repo.save(job());
    const updated = await repo.update({ ...job(), name: 'renamed' });
    expect(updated.name).toBe('renamed');
    expect((await repo.get('job-1'))!.name).toBe('renamed');
  });

  it('deletes a job', async () => {
    const repo = new MemoryJobRepository();
    await repo.save(job());
    expect(await repo.delete('job-1')).toBe(true);
    expect(await repo.delete('job-1')).toBe(false);
    expect(await repo.get('job-1')).toBeNull();
  });

  it('lists jobs and applies filters', async () => {
    const repo = new MemoryJobRepository();
    await repo.save(job({ id: 'a', kind: 'crawl', status: 'pending', storeId: 'store-1', enabled: true }));
    await repo.save(job({ id: 'b', kind: 'analysis', status: 'pending', storeId: 'store-2', enabled: true }));
    await repo.save(job({ id: 'c', kind: 'execution', status: 'failed', storeId: 'store-1', enabled: false }));

    expect((await repo.list()).map((j) => j.id)).toEqual(['a', 'b', 'c']);
    expect((await repo.list({ kind: 'crawl' })).map((j) => j.id)).toEqual(['a']);
    expect((await repo.list({ status: 'failed' })).map((j) => j.id)).toEqual(['c']);
    expect((await repo.list({ storeId: 'store-1' })).map((j) => j.id)).toEqual(['a', 'c']);
    expect((await repo.list({ enabled: false })).map((j) => j.id)).toEqual(['c']);
    expect((await repo.list({ kind: 'analysis', status: 'pending', storeId: 'store-2' })).map((j) => j.id)).toEqual(['b']);
    expect(await repo.list({ kind: 'crawl', storeId: 'store-2' })).toEqual([]);
  });

  it('returns only enabled pending due jobs in priority order', async () => {
    const repo = new MemoryJobRepository();
    const now = new Date('2026-01-05T10:00:00.000Z');
    await repo.save(job({ id: 'low', priority: 'low', nextRunAt: new Date('2026-01-05T09:00:00.000Z') }));
    await repo.save(job({ id: 'critical', priority: 'critical', nextRunAt: new Date('2026-01-05T10:00:00.000Z') }));
    await repo.save(job({ id: 'disabled', priority: 'critical', enabled: false, nextRunAt: now }));
    await repo.save(job({ id: 'running', priority: 'critical', status: 'running', nextRunAt: now }));
    await repo.save(job({ id: 'terminal', priority: 'critical', status: 'succeeded', nextRunAt: now }));
    await repo.save(job({ id: 'no-next', priority: 'critical', nextRunAt: null }));
    await repo.save(job({ id: 'future', priority: 'critical', nextRunAt: new Date('2026-01-05T11:00:00.000Z') }));

    const due = await repo.nextDue(now);
    expect(due.map((j) => j.id)).toEqual(['critical', 'low']);
  });

  it('honors the limit on nextDue and sorts ties by id', async () => {
    const repo = new MemoryJobRepository();
    const now = new Date('2026-01-05T10:00:00.000Z');
    await repo.save(job({ id: 'z', nextRunAt: now }));
    await repo.save(job({ id: 'a', nextRunAt: now }));
    await repo.save(job({ id: 'm', nextRunAt: now }));
    const due = await repo.nextDue(now, 2);
    expect(due.map((j) => j.id)).toEqual(['a', 'm']);
  });

  it('records and reads runs', async () => {
    const repo = new MemoryJobRepository();
    const first = run({ id: 'run-1', scheduledFor: new Date('2026-01-05T09:00:00.000Z') });
    const second = run({ id: 'run-2', scheduledFor: new Date('2026-01-05T10:00:00.000Z') });
    await repo.saveRun(first);
    await repo.saveRun(second);
    expect(await repo.getRun('run-1')).toEqual(first);
    expect(await repo.getRun('missing')).toBeNull();
    const runs = await repo.listRuns('job-1');
    expect(runs.map((r) => r.id)).toEqual(['run-1', 'run-2']);
  });

  it('updates a run', async () => {
    const repo = new MemoryJobRepository();
    await repo.saveRun(run());
    await repo.updateRun({ ...run(), status: 'succeeded', finishedAt: new Date('2026-01-05T10:01:00.000Z') });
    expect((await repo.getRun('run-1'))!.status).toBe('succeeded');
  });

  it('sorts jobs without a next fire time after scheduled ones', async () => {
    const repo = new MemoryJobRepository();
    await repo.save(job({ id: 'b-done', priority: 'normal', nextRunAt: null }));
    await repo.save(job({ id: 'a-pending', priority: 'normal', nextRunAt: new Date('2026-01-05T10:00:00.000Z') }));
    await repo.save(job({ id: 'c-done', priority: 'normal', nextRunAt: null }));
    const ids = (await repo.list()).map((j) => j.id);
    expect(ids).toEqual(['a-pending', 'b-done', 'c-done']);
  });
});

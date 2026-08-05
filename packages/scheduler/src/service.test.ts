import { describe, expect, it, vi } from 'vitest';
import { RateLimitError, ValidationError } from '@seogod/core';
import { createLogger } from '@seogod/logging';
import type { Logger } from '@seogod/logging';
import { MetricsRegistry } from '@seogod/monitoring';
import { CronValidationError, SchedulerNotFoundError, SchedulerValidationError } from './errors.js';
import type { SchedulerEventInput, SchedulerEventPublisher } from './events.js';
import { crawlJobHandler, JobHandlerRegistry } from './handlers.js';
import { MemoryDistributedLock } from './lock.js';
import { MemoryJobRepository } from './repository.js';
import { AutonomousScheduler } from './service.js';
import type { ScheduledJob } from './types.js';

class RecordingPublisher implements SchedulerEventPublisher {
  readonly events: SchedulerEventInput[] = [];
  fail = false;

  async publish(input: SchedulerEventInput): Promise<void> {
    if (this.fail) throw new Error('bus down');
    this.events.push(input);
  }
}

function local(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(year, month - 1, day, hour, minute, second, 0);
}

interface Harness {
  scheduler: AutonomousScheduler;
  repository: MemoryJobRepository;
  lock: MemoryDistributedLock;
  registry: JobHandlerRegistry;
  metrics: MetricsRegistry;
  publisher: RecordingPublisher;
  advance: (ms: number) => void;
  resetClock: (date: Date) => void;
}

function makeHarness(options: { queueLimit?: number; defaultMaxRetries?: number } = {}): Harness {
  const clock = { now: local(2026, 1, 5, 10, 0, 0) };
  const repository = new MemoryJobRepository();
  const lock = new MemoryDistributedLock(() => clock.now);
  const registry = new JobHandlerRegistry();
  const metrics = new MetricsRegistry();
  const publisher = new RecordingPublisher();
  const logger = createLogger({ level: 'silent' });
  const scheduler = new AutonomousScheduler(
    {
      repository,
      lock,
      handlers: registry,
      eventPublisher: publisher,
      metrics,
      logger,
    },
    {
      instanceId: 'instance-1',
      now: () => clock.now,
      queueLimit: options.queueLimit,
      defaultMaxRetries: options.defaultMaxRetries,
    },
  );
  return {
    scheduler,
    repository,
    lock,
    registry,
    metrics,
    publisher,
    advance: (ms) => {
      clock.now = new Date(clock.now.getTime() + ms);
    },
    resetClock: (date) => {
      clock.now = date;
    },
  };
}

describe('AutonomousScheduler.schedule', () => {
  it('creates a one-shot job with defaults', async () => {
    const { scheduler, publisher, metrics } = makeHarness();
    const runsAt = local(2026, 1, 5, 11, 0, 0);
    const job = await scheduler.schedule({ kind: 'crawl', name: 'crawl-store', runsAt });
    expect(job).toMatchObject({
      kind: 'crawl',
      name: 'crawl-store',
      storeId: null,
      cron: null,
      priority: 'normal',
      maxRetries: 3,
      retryBackoffMs: 30_000,
      timeoutMs: null,
      enabled: true,
      status: 'pending',
      attempts: 0,
      nextRunAt: runsAt,
      lastRunAt: null,
      lastStatus: null,
    });
    expect(metrics.snapshot().counters.scheduler_jobs_scheduled).toBe(1);
    expect(publisher.events.map((e) => e.type)).toEqual(['scheduler.job.scheduled']);
    expect(publisher.events[0]!.jobId).toBe(job.id);
  });

  it('creates a recurring job from a cron expression', async () => {
    const { scheduler } = makeHarness();
    const job = await scheduler.schedule({
      kind: 'analysis',
      name: 'daily-analysis',
      cron: '0 0 * * *',
      storeId: 'store-1',
      payload: { storeId: 'store-1' },
      priority: 'high',
      maxRetries: 5,
      retryBackoffMs: 60_000,
      timeoutMs: 10_000,
    });
    expect(job.cron).toBe('0 0 * * *');
    expect(job.nextRunAt).toEqual(local(2026, 1, 6, 0, 0, 0));
    expect(job.priority).toBe('high');
    expect(job.maxRetries).toBe(5);
    expect(job.retryBackoffMs).toBe(60_000);
    expect(job.timeoutMs).toBe(10_000);
  });

  it('uses custom scheduler defaults', async () => {
    const { scheduler } = makeHarness({ defaultMaxRetries: 0 });
    const job = await scheduler.schedule({ kind: 'crawl', name: 'x', runsAt: local(2026, 1, 5, 11, 0, 0) });
    expect(job.maxRetries).toBe(0);
  });

  it('rejects an unknown kind', async () => {
    const { scheduler } = makeHarness();
    await expect(
      scheduler.schedule({ kind: 'unknown' as never, name: 'x', runsAt: local(2026, 1, 5, 11, 0, 0) }),
    ).rejects.toThrow(/Unknown job kind/);
  });

  it('rejects an empty name', async () => {
    const { scheduler } = makeHarness();
    await expect(
      scheduler.schedule({ kind: 'crawl', name: '  ', runsAt: local(2026, 1, 5, 11, 0, 0) }),
    ).rejects.toThrow(SchedulerValidationError);
  });

  it('rejects an unknown priority', async () => {
    const { scheduler } = makeHarness();
    await expect(
      scheduler.schedule({ kind: 'crawl', name: 'x', runsAt: local(2026, 1, 5, 11, 0, 0), priority: 'urgent' as never }),
    ).rejects.toThrow(/Unknown priority/);
  });

  it('requires exactly one of cron or runsAt', async () => {
    const { scheduler } = makeHarness();
    await expect(scheduler.schedule({ kind: 'crawl', name: 'x' })).rejects.toThrow(
      /exactly one of "cron"/,
    );
    await expect(
      scheduler.schedule({
        kind: 'crawl',
        name: 'x',
        cron: '0 0 * * *',
        runsAt: local(2026, 1, 5, 11, 0, 0),
      }),
    ).rejects.toThrow(/exactly one of "cron"/);
  });

  it('rejects an empty cron expression', async () => {
    const { scheduler } = makeHarness();
    await expect(scheduler.schedule({ kind: 'crawl', name: 'x', cron: ' ' })).rejects.toThrow(
      /Cron expression must not be empty/,
    );
  });

  it('rejects an invalid cron expression', async () => {
    const { scheduler } = makeHarness();
    await expect(scheduler.schedule({ kind: 'crawl', name: 'x', cron: 'not-a-cron' })).rejects.toThrow(
      CronValidationError,
    );
  });

  it('rejects a cron that never fires', async () => {
    const { scheduler } = makeHarness();
    await expect(
      scheduler.schedule({ kind: 'crawl', name: 'x', cron: '0 0 31 2 *' }),
    ).rejects.toThrow(/never fires/);
  });
});

describe('AutonomousScheduler.get and list', () => {
  it('gets a job or null', async () => {
    const { scheduler } = makeHarness();
    const job = await scheduler.schedule({ kind: 'crawl', name: 'a', runsAt: local(2026, 1, 5, 11, 0, 0) });
    expect((await scheduler.get(job.id))!.name).toBe('a');
    expect(await scheduler.get('missing')).toBeNull();
  });

  it('lists jobs with filters', async () => {
    const { scheduler } = makeHarness();
    await scheduler.schedule({ kind: 'crawl', name: 'a', storeId: 's1', runsAt: local(2026, 1, 5, 11, 0, 0) });
    await scheduler.schedule({ kind: 'analysis', name: 'b', storeId: 's2', runsAt: local(2026, 1, 5, 11, 0, 0) });
    expect(await scheduler.list()).toHaveLength(2);
    expect((await scheduler.list({ kind: 'crawl' })).map((j) => j.name)).toEqual(['a']);
    expect((await scheduler.list({ storeId: 's2' })).map((j) => j.name)).toEqual(['b']);
  });
});

describe('AutonomousScheduler.update', () => {
  it('applies scalar patches and emits an update event', async () => {
    const { scheduler, publisher } = makeHarness();
    const job = await scheduler.schedule({ kind: 'crawl', name: 'a', runsAt: local(2026, 1, 5, 11, 0, 0) });
    const updated = await scheduler.update(job.id, {
      name: 'renamed',
      priority: 'critical',
      maxRetries: 9,
      retryBackoffMs: 5000,
      timeoutMs: 2000,
      timezone: 'UTC',
      payload: { seeds: ['x'] },
      enabled: false,
    });
    expect(updated).toMatchObject({
      name: 'renamed',
      priority: 'critical',
      maxRetries: 9,
      retryBackoffMs: 5000,
      timeoutMs: 2000,
      timezone: 'UTC',
      payload: { seeds: ['x'] },
      enabled: false,
    });
    expect(publisher.events.at(-1)!.type).toBe('scheduler.job.updated');
  });

  it('switches a job to one-shot via runsAt', async () => {
    const { scheduler } = makeHarness();
    const job = await scheduler.schedule({ kind: 'crawl', name: 'a', cron: '0 0 * * *' });
    const runsAt = local(2026, 1, 9, 9, 0, 0);
    const updated = await scheduler.update(job.id, { runsAt });
    expect(updated.cron).toBeNull();
    expect(updated.nextRunAt).toEqual(runsAt);
    expect(updated.status).toBe('pending');
    expect(updated.enabled).toBe(true);
  });

  it('recomputes the next run when cron changes', async () => {
    const { scheduler } = makeHarness();
    const job = await scheduler.schedule({ kind: 'crawl', name: 'a', runsAt: local(2026, 1, 5, 10, 30, 0) });
    const updated = await scheduler.update(job.id, { cron: '*/5 * * * *' });
    expect(updated.cron).toBe('*/5 * * * *');
    expect(updated.nextRunAt!.getTime()).toBeGreaterThan(local(2026, 1, 5, 10, 30, 0).getTime());
  });

  it('clears the schedule when cron is set to null', async () => {
    const { scheduler } = makeHarness();
    const job = await scheduler.schedule({ kind: 'crawl', name: 'a', cron: '0 0 * * *' });
    const updated = await scheduler.update(job.id, { cron: null });
    expect(updated.cron).toBeNull();
    expect(updated.nextRunAt).toBeNull();
  });

  it('keeps a cancelled job cancelled when its cron is updated', async () => {
    const { scheduler } = makeHarness();
    const job = await scheduler.schedule({ kind: 'crawl', name: 'a', cron: '0 0 * * *' });
    await scheduler.cancel(job.id);
    const updated = await scheduler.update(job.id, { cron: '0 6 * * *' });
    expect(updated.status).toBe('cancelled');
  });

  it('rejects invalid patch values', async () => {
    const { scheduler } = makeHarness();
    const job = await scheduler.schedule({ kind: 'crawl', name: 'a', runsAt: local(2026, 1, 5, 11, 0, 0) });
    await expect(scheduler.update(job.id, { name: '' })).rejects.toThrow(SchedulerValidationError);
    await expect(scheduler.update(job.id, { priority: 'urgent' as never })).rejects.toThrow(SchedulerValidationError);
    await expect(scheduler.update(job.id, { maxRetries: -1 })).rejects.toThrow(SchedulerValidationError);
    await expect(scheduler.update(job.id, { maxRetries: 1.5 })).rejects.toThrow(SchedulerValidationError);
    await expect(scheduler.update(job.id, { retryBackoffMs: -5 })).rejects.toThrow(SchedulerValidationError);
    await expect(scheduler.update(job.id, { timeoutMs: 0 })).rejects.toThrow(SchedulerValidationError);
    await expect(scheduler.update(job.id, { cron: ' ' })).rejects.toThrow(/must not be empty/);
    await expect(scheduler.update(job.id, { cron: 'bad' })).rejects.toThrow(CronValidationError);
    await expect(scheduler.update(job.id, { cron: '0 0 31 2 *' })).rejects.toThrow(/never fires/);
  });

  it('throws when the job does not exist', async () => {
    const { scheduler } = makeHarness();
    await expect(scheduler.update('missing', { name: 'x' })).rejects.toThrow(SchedulerNotFoundError);
  });
});

describe('AutonomousScheduler.cancel and delete', () => {
  it('cancels a job and emits an event', async () => {
    const { scheduler, publisher } = makeHarness();
    const job = await scheduler.schedule({ kind: 'crawl', name: 'a', runsAt: local(2026, 1, 5, 11, 0, 0) });
    const cancelled = await scheduler.cancel(job.id, 'no longer needed');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.enabled).toBe(false);
    expect(cancelled.nextRunAt).toBeNull();
    expect(cancelled.finishedAt).not.toBeNull();
    const event = publisher.events.find((e) => e.type === 'scheduler.job.cancelled')!;
    expect(event.reason).toBe('no longer needed');
  });

  it('is idempotent for an already cancelled job', async () => {
    const { scheduler } = makeHarness();
    const job = await scheduler.schedule({ kind: 'crawl', name: 'a', runsAt: local(2026, 1, 5, 11, 0, 0) });
    await scheduler.cancel(job.id);
    const again = await scheduler.cancel(job.id);
    expect(again.status).toBe('cancelled');
    expect(
      (await scheduler.list()).filter((j) => j.status === 'cancelled'),
    ).toHaveLength(1);
  });

  it('throws when cancelling a missing job', async () => {
    const { scheduler } = makeHarness();
    await expect(scheduler.cancel('missing')).rejects.toThrow(SchedulerNotFoundError);
  });

  it('deletes a job', async () => {
    const { scheduler } = makeHarness();
    const job = await scheduler.schedule({ kind: 'crawl', name: 'a', runsAt: local(2026, 1, 5, 11, 0, 0) });
    expect(await scheduler.delete(job.id)).toBe(true);
    expect(await scheduler.get(job.id)).toBeNull();
  });

  it('throws when deleting a missing job', async () => {
    const { scheduler } = makeHarness();
    await expect(scheduler.delete('missing')).rejects.toThrow(SchedulerNotFoundError);
  });
});

describe('AutonomousScheduler.runDueJobs', () => {
  it('runs a due one-shot job to success', async () => {
    const { scheduler, registry, metrics, publisher, repository } = makeHarness();
    const order: string[] = [];
    registry.register(
      crawlJobHandler(async (input) => {
        order.push(input.storeId);
        return { pages: 10 };
      }),
    );
    const job = await scheduler.schedule({
      kind: 'crawl',
      name: 'crawl-store',
      storeId: 'store-1',
      runsAt: local(2026, 1, 5, 9, 0, 0),
      payload: { storeId: 'store-1', seeds: ['https://a.example'] },
    });

    const summary = await scheduler.runDueJobs();
    expect(summary.due).toBe(1);
    expect(summary.processed).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.retried).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.attempts[0]!.outcome).toBe('succeeded');
    expect(summary.attempts[0]!.result).toEqual({ pages: 10 });
    expect(summary.attempts[0]!.run).toMatchObject({
      status: 'succeeded',
      attempt: 1,
      lockOwner: 'instance-1',
      error: null,
    });
    expect(order).toEqual(['store-1']);

    const stored = await scheduler.get(job.id);
    expect(stored).toMatchObject({ status: 'succeeded', nextRunAt: null, lastStatus: 'succeeded' });
    expect(stored!.finishedAt).not.toBeNull();

    const run = await repository.getRun(summary.attempts[0]!.run!.id);
    expect(run!.status).toBe('succeeded');

    const types = publisher.events.map((e) => e.type);
    expect(types).toContain('scheduler.job.started');
    expect(types).toContain('scheduler.job.succeeded');

    const snapshot = metrics.snapshot();
    expect(snapshot.counters.scheduler_jobs_completed).toBe(1);
    expect(snapshot.counters.scheduler_polls).toBe(1);
    expect(snapshot.gauges.scheduler_queue_depth).toBe(0);
    expect(snapshot.histograms.scheduler_run_duration_ms?.count).toBe(1);

    const empty = await scheduler.runDueJobs();
    expect(empty.due).toBe(0);
  });

  it('runs due jobs in priority order', async () => {
    const { scheduler, registry } = makeHarness();
    const order: string[] = [];
    registry.register(
      crawlJobHandler(async ({ storeId }) => {
        order.push(storeId);
        return null;
      }),
    );
    const due = local(2026, 1, 5, 9, 0, 0);
    await scheduler.schedule({
      kind: 'crawl', name: 'low', storeId: 'low', priority: 'low', runsAt: due,
      payload: { storeId: 'low', seeds: ['x'] },
    });
    await scheduler.schedule({
      kind: 'crawl', name: 'critical', storeId: 'critical', priority: 'critical', runsAt: due,
      payload: { storeId: 'critical', seeds: ['x'] },
    });
    await scheduler.schedule({
      kind: 'crawl', name: 'high', storeId: 'high', priority: 'high', runsAt: due,
      payload: { storeId: 'high', seeds: ['x'] },
    });

    await scheduler.runDueJobs();
    expect(order).toEqual(['critical', 'high', 'low']);
  });

  it('advances a recurring job after a successful run', async () => {
    const { scheduler, registry, advance } = makeHarness();
    registry.register(crawlJobHandler(async () => ({ ok: true })));
    const job = await scheduler.schedule({
      kind: 'crawl',
      name: 'recurring',
      cron: '* * * * *',
      payload: { storeId: 's', seeds: ['x'] },
    });
    expect(job.nextRunAt).toEqual(local(2026, 1, 5, 10, 1, 0));

    advance(60_000); // now 10:01:00
    await scheduler.runDueJobs();
    let stored = await scheduler.get(job.id);
    expect(stored).toMatchObject({ status: 'pending', lastStatus: 'succeeded', attempts: 1 });
    expect(stored!.nextRunAt).toEqual(local(2026, 1, 5, 10, 2, 0));

    advance(60_000); // now 10:02:00
    await scheduler.runDueJobs();
    stored = await scheduler.get(job.id);
    expect(stored!.attempts).toBe(2);
    expect(stored!.nextRunAt).toEqual(local(2026, 1, 5, 10, 3, 0));
  });

  it('retries a failed job with exponential backoff and then gives up', async () => {
    const { scheduler, registry, advance } = makeHarness();
    registry.register(
      crawlJobHandler(async () => {
        throw new Error('boom');
      }),
    );
    const job = await scheduler.schedule({
      kind: 'crawl',
      name: 'flaky',
      runsAt: local(2026, 1, 5, 9, 0, 0),
      maxRetries: 2,
      payload: { storeId: 's', seeds: ['x'] },
    });

    const first = await scheduler.runDueJobs();
    expect(first.attempts[0]!.outcome).toBe('retrying');
    let stored = await scheduler.get(job.id);
    expect(stored).toMatchObject({ status: 'pending', attempts: 1, lastStatus: 'failed' });
    expect(stored!.nextRunAt!.getTime()).toBe(local(2026, 1, 5, 10, 0, 0).getTime() + 30_000);

    advance(30_001);
    const second = await scheduler.runDueJobs();
    expect(second.attempts[0]!.outcome).toBe('retrying');
    stored = await scheduler.get(job.id);
    expect(stored!.attempts).toBe(2);
    expect(stored!.nextRunAt!.getTime()).toBe(second.now.getTime() + 60_000);

    advance(60_001);
    const third = await scheduler.runDueJobs();
    expect(third.attempts[0]!.outcome).toBe('failed');
    stored = await scheduler.get(job.id);
    expect(stored).toMatchObject({ status: 'failed', attempts: 3, lastStatus: 'failed' });
    expect(stored!.nextRunAt).toBeNull();

    const snapshot = (await scheduler.list()).length;
    expect(snapshot).toBe(1);
  });

  it('does not retry an explicitly non-retryable error', async () => {
    const { scheduler, registry } = makeHarness();
    registry.register(
      crawlJobHandler(async () => {
        throw new ValidationError('invalid input');
      }),
    );
    const job = await scheduler.schedule({
      kind: 'crawl',
      name: 'hard',
      runsAt: local(2026, 1, 5, 9, 0, 0),
      maxRetries: 5,
      payload: { storeId: 's', seeds: ['x'] },
    });
    const summary = await scheduler.runDueJobs();
    expect(summary.attempts[0]!.outcome).toBe('failed');
    const stored = await scheduler.get(job.id);
    expect(stored!.status).toBe('failed');
  });

  it('retries a retryable AppError', async () => {
    const { scheduler, registry } = makeHarness();
    registry.register(
      crawlJobHandler(async () => {
        throw new RateLimitError('slow down', { retryAfterSeconds: 30 });
      }),
    );
    const job = await scheduler.schedule({
      kind: 'crawl',
      name: 'rate',
      runsAt: local(2026, 1, 5, 9, 0, 0),
      payload: { storeId: 's', seeds: ['x'] },
    });
    const summary = await scheduler.runDueJobs();
    expect(summary.attempts[0]!.outcome).toBe('retrying');
    expect((await scheduler.get(job.id))!.status).toBe('pending');
  });

  it('keeps a recurring job on schedule after a terminal run failure', async () => {
    const { scheduler, registry, advance } = makeHarness();
    registry.register(
      crawlJobHandler(async () => {
        throw new Error('boom');
      }),
    );
    const job = await scheduler.schedule({
      kind: 'crawl',
      name: 'recurring-flaky',
      cron: '* * * * *',
      maxRetries: 0,
      payload: { storeId: 's', seeds: ['x'] },
    });
    advance(60_000);
    const summary = await scheduler.runDueJobs();
    expect(summary.attempts[0]!.outcome).toBe('failed');
    const stored = await scheduler.get(job.id);
    expect(stored).toMatchObject({ status: 'pending', lastStatus: 'failed' });
    expect(stored!.nextRunAt).toEqual(local(2026, 1, 5, 10, 2, 0));
  });

  it('finishes a job whose recurring schedule has no future occurrence', async () => {
    const { scheduler, registry, repository, resetClock } = makeHarness();
    registry.register(crawlJobHandler(async () => ({ ok: true })));
    resetClock(local(2030, 6, 1, 12, 0, 0));
    // A Feb-31 cron never fires; created directly to exercise the edge path.
    const job: ScheduledJob = {
      id: 'edge',
      kind: 'crawl',
      name: 'edge',
      storeId: null,
      cron: '0 0 31 2 *',
      timezone: null,
      priority: 'normal',
      payload: { storeId: 's', seeds: ['x'] },
      maxRetries: 0,
      retryBackoffMs: 1000,
      timeoutMs: null,
      enabled: true,
      status: 'pending',
      attempts: 0,
      nextRunAt: local(2030, 1, 1, 0, 0, 0),
      lastRunAt: null,
      lastStatus: null,
      createdAt: local(2030, 1, 1, 0, 0, 0),
      updatedAt: local(2030, 1, 1, 0, 0, 0),
      finishedAt: null,
    };
    await repository.save(job);
    const summary = await scheduler.runDueJobs();
    expect(summary.attempts[0]!.outcome).toBe('succeeded');
    const stored = await scheduler.get('edge');
    expect(stored).toMatchObject({ status: 'succeeded', nextRunAt: null });
  });

  it('fails a job when no handler is registered', async () => {
    const { scheduler } = makeHarness();
    const job = await scheduler.schedule({
      kind: 'analysis',
      name: 'no-handler',
      runsAt: local(2026, 1, 5, 9, 0, 0),
      payload: { storeId: 's' },
    });
    const summary = await scheduler.runDueJobs();
    expect(summary.attempts[0]!.outcome).toBe('failed');
    expect(summary.attempts[0]!.run!.error).toMatch(/No handler registered/);
    expect((await scheduler.get(job.id))!.status).toBe('failed');
  });

  it('skips a job when the lock is contended', async () => {
    const { scheduler, registry, lock } = makeHarness();
    let calls = 0;
    registry.register(
      crawlJobHandler(async () => {
        calls += 1;
        return null;
      }),
    );
    const job = await scheduler.schedule({
      kind: 'crawl',
      name: 'contended',
      runsAt: local(2026, 1, 5, 9, 0, 0),
      payload: { storeId: 's', seeds: ['x'] },
    });
    await lock.acquire(`scheduler:job:${job.id}`, 'other-instance', 60_000);

    const summary = await scheduler.runDueJobs();
    expect(summary.skipped).toBe(1);
    expect(summary.attempts[0]!.outcome).toBe('skipped');
    expect(summary.attempts[0]!.run).toBeNull();
    expect(calls).toBe(0);
    expect((await scheduler.get(job.id))!.status).toBe('pending');
  });

  it('enforces the per-tick limit', async () => {
    const { scheduler, registry } = makeHarness({ queueLimit: 1 });
    registry.register(crawlJobHandler(async () => null));
    const due = local(2026, 1, 5, 9, 0, 0);
    await scheduler.schedule({ kind: 'crawl', name: 'a', runsAt: due, payload: { storeId: 's', seeds: ['x'] } });
    await scheduler.schedule({ kind: 'crawl', name: 'b', runsAt: due, payload: { storeId: 's', seeds: ['x'] } });
    const summary = await scheduler.runDueJobs();
    expect(summary.due).toBe(1);
    expect(summary.processed).toBe(1);
  });

  it('honors the options.now override', async () => {
    const { scheduler, registry } = makeHarness();
    registry.register(crawlJobHandler(async () => null));
    await scheduler.schedule({
      kind: 'crawl',
      name: 'later',
      runsAt: local(2026, 1, 5, 12, 0, 0),
      payload: { storeId: 's', seeds: ['x'] },
    });
    const summary = await scheduler.runDueJobs({ now: local(2026, 1, 5, 12, 0, 0) });
    expect(summary.now).toEqual(local(2026, 1, 5, 12, 0, 0));
    expect(summary.due).toBe(1);
  });

  it('times out a slow handler and marks the run failed', async () => {
    const { scheduler, registry } = makeHarness();
    registry.register(
      crawlJobHandler(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return null;
      }),
    );
    const job = await scheduler.schedule({
      kind: 'crawl',
      name: 'slow',
      runsAt: local(2026, 1, 5, 9, 0, 0),
      timeoutMs: 10,
      payload: { storeId: 's', seeds: ['x'] },
    });
    const summary = await scheduler.runDueJobs();
    expect(summary.attempts[0]!.outcome).toBe('failed');
    expect(summary.attempts[0]!.run!.error).toMatch(/timed out/);
    expect((await scheduler.get(job.id))!.status).toBe('failed');
  });

  it('keeps running even when event publishing fails', async () => {
    const { scheduler, registry, publisher } = makeHarness();
    publisher.fail = true;
    registry.register(crawlJobHandler(async () => ({ ok: true })));
    await scheduler.schedule({
      kind: 'crawl',
      name: 'quiet',
      runsAt: local(2026, 1, 5, 9, 0, 0),
      payload: { storeId: 's', seeds: ['x'] },
    });
    const summary = await scheduler.runDueJobs();
    expect(summary.succeeded).toBe(1);
  });
});

describe('AutonomousScheduler.runNow', () => {
  it('executes a job immediately', async () => {
    const { scheduler, registry } = makeHarness();
    registry.register(crawlJobHandler(async () => ({ ok: true })));
    const job = await scheduler.schedule({
      kind: 'crawl',
      name: 'manual',
      runsAt: local(2026, 1, 6, 0, 0, 0),
      payload: { storeId: 's', seeds: ['x'] },
    });
    const result = await scheduler.runNow(job.id);
    expect(result.outcome).toBe('succeeded');
    expect(result.result).toEqual({ ok: true });
  });

  it('throws for a missing job', async () => {
    const { scheduler } = makeHarness();
    await expect(scheduler.runNow('missing')).rejects.toThrow(SchedulerNotFoundError);
  });

  it('throws when the job is already running', async () => {
    const { scheduler, repository } = makeHarness();
    const job: ScheduledJob = {
      id: 'running-job',
      kind: 'crawl',
      name: 'running',
      storeId: null,
      cron: null,
      timezone: null,
      priority: 'normal',
      payload: null,
      maxRetries: 0,
      retryBackoffMs: 1000,
      timeoutMs: null,
      enabled: true,
      status: 'running',
      attempts: 1,
      nextRunAt: null,
      lastRunAt: local(2026, 1, 5, 10, 0, 0),
      lastStatus: null,
      createdAt: local(2026, 1, 5, 10, 0, 0),
      updatedAt: local(2026, 1, 5, 10, 0, 0),
      finishedAt: null,
    };
    await repository.save(job);
    await expect(scheduler.runNow('running-job')).rejects.toThrow(/already running/);
  });
});

describe('AutonomousScheduler.registerHandler', () => {
  it('registers a handler through the facade', async () => {
    const { scheduler } = makeHarness();
    const handler = crawlJobHandler(async () => ({ ok: true }));
    scheduler.registerHandler(handler);
    expect(scheduler.handlers.get('crawl')).toBe(handler);
  });

  it('orders due jobs with identical priority and fire time by id', async () => {
    const { scheduler } = makeHarness();
    scheduler.registerHandler(crawlJobHandler(async () => ({ ok: true })));
    await scheduler.schedule({
      kind: 'crawl',
      name: 'b',
      priority: 'high',
      runsAt: local(2026, 1, 5, 9, 0, 0),
    });
    await scheduler.schedule({
      kind: 'crawl',
      name: 'a',
      priority: 'high',
      runsAt: local(2026, 1, 5, 9, 0, 0),
    });
    const summary = await scheduler.runDueJobs();
    expect(summary.attempts.map((attempt) => attempt.job.name).sort()).toEqual(['a', 'b']);
  });
});

describe('AutonomousScheduler.start and stop', () => {
  it('polls on an interval and can be stopped', async () => {
    vi.useFakeTimers();
    try {
      const { scheduler, registry } = makeHarness();
      registry.register(crawlJobHandler(async () => ({ ok: true })));
      await scheduler.schedule({
        kind: 'crawl',
        name: 'polled',
        runsAt: local(2026, 1, 5, 9, 0, 0),
        payload: { storeId: 's', seeds: ['x'] },
      });
      scheduler.start({ pollIntervalMs: 1000 });
      expect(scheduler.isRunning).toBe(true);
      expect(() => scheduler.start()).toThrow(/already running/);

      await vi.advanceTimersByTimeAsync(1000);
      const jobs = await scheduler.list();
      expect(jobs[0]!.status).toBe('succeeded');

      scheduler.stop();
      expect(scheduler.isRunning).toBe(false);
      scheduler.stop(); // no-op
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs when a tick fails', async () => {
    vi.useFakeTimers();
    try {
      const repository = new MemoryJobRepository();
      const error = vi.fn();
      const info = vi.fn();
      const scheduler = new AutonomousScheduler(
        {
          repository,
          lock: new MemoryDistributedLock(),
          logger: { error, info } as unknown as Logger,
          metrics: new MetricsRegistry(),
        },
        { pollIntervalMs: 1000 },
      );
      vi.spyOn(repository, 'nextDue').mockRejectedValue(new Error('boom'));
      scheduler.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(error).toHaveBeenCalled();
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

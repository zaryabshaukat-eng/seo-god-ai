/**
 * The autonomous scheduler.
 *
 * Orchestrates the whole package: jobs are scheduled (cron or one-shot),
 * persisted through a {@link JobRepository}, run through registered
 * {@link JobHandler}s in priority order with a distributed lock, retried
 * with exponential backoff, and every state change is emitted to the outbox
 * and counted in monitoring.
 *
 * Run one tick manually with {@link AutonomousScheduler.runDueJobs} or let
 * {@link AutonomousScheduler.start} poll on an interval.
 */

import { randomUUID } from 'node:crypto';
import { isAppError } from '@seogod/core';
import type { Logger } from '@seogod/logging';
import { MetricsRegistry } from '@seogod/monitoring';
import { parseCron } from './cron.js';
import {
  JobTimeoutError,
  MissingHandlerError,
  SchedulerError,
  SchedulerNotFoundError,
  SchedulerValidationError,
} from './errors.js';
import type { SchedulerEventPublisher, SchedulerEventType } from './events.js';
import type { JobExecutionInput, JobHandler } from './handlers.js';
import { JobHandlerRegistry } from './handlers.js';
import type { DistributedLock } from './lock.js';
import { SchedulerMetrics } from './metrics.js';
import { PriorityQueue } from './priority-queue.js';
import type { JobRepository } from './repository.js';
import type {
  JobFilter,
  JobPriority,
  JobRun,
  JobRunResult,
  ScheduledJob,
  ScheduleJobInput,
  SchedulerRunSummary,
  UpdateJobInput,
} from './types.js';
import { JOB_KINDS, JOB_PRIORITIES } from './types.js';

export interface AutonomousSchedulerDependencies {
  repository: JobRepository;
  lock: DistributedLock;
  /** Optional; defaults to an empty registry (jobs fail without handlers). */
  handlers?: JobHandlerRegistry;
  eventPublisher?: SchedulerEventPublisher;
  metrics?: MetricsRegistry;
  logger: Logger;
}

export interface AutonomousSchedulerOptions {
  /** Stable id for this instance; used as the distributed lock owner. */
  instanceId?: string;
  pollIntervalMs?: number;
  defaultMaxRetries?: number;
  defaultRetryBackoffMs?: number;
  /** How long a job lock is held before it expires. */
  lockTtlMs?: number;
  /** Cap on jobs picked up per tick. */
  queueLimit?: number;
  now?: () => Date;
}

const MAX_BACKOFF_MS = 7 * 24 * 60 * 60 * 1000;
const PRIORITY_RANK: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function queueComparator(a: ScheduledJob, b: ScheduledJob): number {
  const rankA = PRIORITY_RANK[a.priority] ?? Number.MAX_SAFE_INTEGER;
  const rankB = PRIORITY_RANK[b.priority] ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  const dueA = a.nextRunAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const dueB = b.nextRunAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (dueA !== dueB) return dueA - dueB;
  return a.id.localeCompare(b.id);
}

export class AutonomousScheduler {
  readonly instanceId: string;
  readonly handlers: JobHandlerRegistry;

  private readonly repository: JobRepository;
  private readonly lock: DistributedLock;
  private readonly eventPublisher?: SchedulerEventPublisher;
  private readonly metrics: SchedulerMetrics;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly pollIntervalMs: number;
  private readonly defaultMaxRetries: number;
  private readonly defaultRetryBackoffMs: number;
  private readonly lockTtlMs: number;
  private readonly queueLimit: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    deps: AutonomousSchedulerDependencies,
    options: AutonomousSchedulerOptions = {},
  ) {
    this.instanceId = options.instanceId ?? randomUUID();
    this.repository = deps.repository;
    this.lock = deps.lock;
    this.handlers = deps.handlers ?? new JobHandlerRegistry();
    this.eventPublisher = deps.eventPublisher;
    this.metrics = new SchedulerMetrics(deps.metrics ?? new MetricsRegistry());
    this.logger = deps.logger;
    this.now = options.now ?? (() => new Date());
    this.pollIntervalMs = options.pollIntervalMs ?? 60_000;
    this.defaultMaxRetries = options.defaultMaxRetries ?? 3;
    this.defaultRetryBackoffMs = options.defaultRetryBackoffMs ?? 30_000;
    this.lockTtlMs = options.lockTtlMs ?? 60_000;
    this.queueLimit = options.queueLimit ?? 100;
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  /** Registers a handler; a later registration for the same kind replaces it. */
  registerHandler(handler: JobHandler): void {
    this.handlers.register(handler);
  }

  /** Creates and persists a job; emits `scheduler.job.scheduled`. */
  async schedule(input: ScheduleJobInput): Promise<ScheduledJob> {
    const kind = input.kind;
    if (!JOB_KINDS.includes(kind)) {
      throw new SchedulerValidationError(
        `Unknown job kind "${kind}"; expected one of ${JOB_KINDS.join(', ')}`,
      );
    }
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      throw new SchedulerValidationError('Job name must be a non-empty string');
    }
    if (input.priority !== undefined && !JOB_PRIORITIES.includes(input.priority)) {
      throw new SchedulerValidationError(
        `Unknown priority "${input.priority}"; expected one of ${JOB_PRIORITIES.join(', ')}`,
      );
    }
    if ((input.cron === undefined) === (input.runsAt === undefined)) {
      throw new SchedulerValidationError(
        'Schedule a job with exactly one of "cron" (recurring) or "runsAt" (one-shot)',
      );
    }
    if (input.cron !== undefined && input.cron !== null && input.cron.trim() === '') {
      throw new SchedulerValidationError('Cron expression must not be empty');
    }

    const now = this.now();
    let cron: string | null = null;
    let nextRunAt: Date | null;
    if (input.runsAt !== undefined) {
      nextRunAt = input.runsAt;
    } else {
      cron = input.cron!;
      const expression = parseCron(cron);
      nextRunAt = expression.nextAfter(now);
      if (nextRunAt === null) {
        throw new SchedulerValidationError(
          `Cron expression "${cron}" never fires within the search horizon`,
        );
      }
    }

    const job: ScheduledJob = {
      id: randomUUID(),
      kind,
      name: input.name,
      storeId: input.storeId ?? null,
      cron,
      timezone: input.timezone ?? null,
      priority: input.priority ?? 'normal',
      payload: input.payload ?? null,
      maxRetries: input.maxRetries ?? this.defaultMaxRetries,
      retryBackoffMs: input.retryBackoffMs ?? this.defaultRetryBackoffMs,
      timeoutMs: input.timeoutMs ?? null,
      enabled: true,
      status: 'pending',
      attempts: 0,
      nextRunAt,
      lastRunAt: null,
      lastStatus: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    };

    await this.repository.save(job);
    this.metrics.jobsScheduled(1);
    await this.emit('scheduler.job.scheduled', job);
    return job;
  }

  /** Applies a partial update; emits `scheduler.job.updated`. */
  async update(id: string, patch: UpdateJobInput): Promise<ScheduledJob> {
    const current = await this.requireJob(id);
    const updated: ScheduledJob = { ...current, updatedAt: this.now() };

    if (patch.name !== undefined) {
      if (typeof patch.name !== 'string' || patch.name.trim() === '') {
        throw new SchedulerValidationError('Job name must be a non-empty string');
      }
      updated.name = patch.name;
    }
    if (patch.priority !== undefined) {
      if (!JOB_PRIORITIES.includes(patch.priority)) {
        throw new SchedulerValidationError(
          `Unknown priority "${patch.priority}"; expected one of ${JOB_PRIORITIES.join(', ')}`,
        );
      }
      updated.priority = patch.priority;
    }
    if (patch.maxRetries !== undefined) {
      if (!Number.isInteger(patch.maxRetries) || patch.maxRetries < 0) {
        throw new SchedulerValidationError('maxRetries must be a non-negative integer');
      }
      updated.maxRetries = patch.maxRetries;
    }
    if (patch.retryBackoffMs !== undefined) {
      if (!Number.isFinite(patch.retryBackoffMs) || patch.retryBackoffMs < 0) {
        throw new SchedulerValidationError('retryBackoffMs must be a non-negative number');
      }
      updated.retryBackoffMs = patch.retryBackoffMs;
    }
    if (patch.timeoutMs !== undefined) {
      if (patch.timeoutMs !== null && (!Number.isFinite(patch.timeoutMs) || patch.timeoutMs <= 0)) {
        throw new SchedulerValidationError('timeoutMs must be null or a positive number');
      }
      updated.timeoutMs = patch.timeoutMs;
    }
    if (patch.timezone !== undefined) {
      updated.timezone = patch.timezone;
    }
    if (patch.payload !== undefined) {
      updated.payload = patch.payload;
    }
    if (patch.enabled !== undefined) {
      updated.enabled = patch.enabled;
    }

    if (patch.runsAt !== undefined) {
      updated.cron = null;
      updated.nextRunAt = patch.runsAt;
      if (updated.status !== 'cancelled') {
        updated.status = 'pending';
        updated.enabled = true;
      }
    }
    if (patch.cron !== undefined) {
      if (patch.cron === null) {
        updated.cron = null;
        updated.nextRunAt = null;
      } else {
        if (patch.cron.trim() === '') {
          throw new SchedulerValidationError('Cron expression must not be empty');
        }
        const expression = parseCron(patch.cron);
        const base = updated.nextRunAt ?? this.now();
        const next = expression.nextAfter(base);
        if (next === null) {
          throw new SchedulerValidationError(
            `Cron expression "${patch.cron}" never fires within the search horizon`,
          );
        }
        updated.cron = patch.cron;
        updated.nextRunAt = next;
        if (updated.status !== 'cancelled') {
          updated.status = 'pending';
          updated.enabled = true;
        }
      }
    }

    const stored = await this.repository.update(updated);
    await this.emit('scheduler.job.updated', stored);
    return stored;
  }

  /** Cancels a job; emits `scheduler.job.cancelled`. Idempotent. */
  async cancel(id: string, reason?: string): Promise<ScheduledJob> {
    const job = await this.requireJob(id);
    if (job.status === 'cancelled') return job;
    const cancelled: ScheduledJob = {
      ...job,
      status: 'cancelled',
      enabled: false,
      nextRunAt: null,
      finishedAt: this.now(),
      updatedAt: this.now(),
    };
    const stored = await this.repository.update(cancelled);
    await this.emit('scheduler.job.cancelled', stored, { reason });
    return stored;
  }

  /** Deletes a job and its metadata. Returns `true` on success. */
  async delete(id: string): Promise<boolean> {
    const job = await this.requireJob(id);
    return this.repository.delete(job.id);
  }

  async get(id: string): Promise<ScheduledJob | null> {
    return this.repository.get(id);
  }

  async list(filter?: JobFilter): Promise<ScheduledJob[]> {
    return this.repository.list(filter);
  }

  /**
   * Picks up every due job and runs one attempt for each, in priority order.
   * Retries are not executed inline: a failed attempt reschedules the job
   * `retryBackoffMs` into the future for the next tick to pick up.
   */
  async runDueJobs(options: { now?: Date; limit?: number } = {}): Promise<SchedulerRunSummary> {
    const now = options.now ?? this.now();
    this.metrics.polls(1);
    const due = await this.repository.nextDue(now, options.limit ?? this.queueLimit);
    const queue = new PriorityQueue<ScheduledJob>(queueComparator);
    for (const job of due) queue.push(job);
    this.metrics.setQueueDepth(queue.size);

    const summary: SchedulerRunSummary = {
      now,
      due: due.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
      skipped: 0,
      attempts: [],
    };

    while (!queue.isEmpty) {
      const job = queue.pop();
      if (job === null) continue;
      const result = await this.runAttempt(job, now);
      summary.attempts.push(result);
      if (result.outcome === 'succeeded') {
        summary.succeeded += 1;
        summary.processed += 1;
      } else if (result.outcome === 'failed') {
        summary.failed += 1;
        summary.processed += 1;
      } else if (result.outcome === 'retrying') {
        summary.retried += 1;
        summary.processed += 1;
      } else {
        summary.skipped += 1;
      }
    }

    this.metrics.setQueueDepth(0);
    return summary;
  }

  /** Forces a single attempt of a job immediately, regardless of due time. */
  async runNow(jobId: string): Promise<JobRunResult> {
    const job = await this.requireJob(jobId);
    if (job.status === 'running') {
      throw new SchedulerError(`Job "${job.name}" is already running`, {
        code: 'job.running',
        context: { jobId: job.id, jobKind: job.kind },
      });
    }
    return this.runAttempt(job, this.now());
  }

  /** Starts periodic polling. No-op-safe; throws when already running. */
  start(options: { pollIntervalMs?: number } = {}): void {
    if (this.timer !== null) {
      throw new SchedulerError('Autonomous scheduler is already running', {
        code: 'job.running',
      });
    }
    const intervalMs = options.pollIntervalMs ?? this.pollIntervalMs;
    this.timer = setInterval(() => {
      void this.runDueJobs().catch((err) => {
        this.logger.error({ err }, 'scheduler.tick-failed');
      });
    }, intervalMs);
    this.logger.info({ intervalMs, instanceId: this.instanceId }, 'scheduler.started');
  }

  /** Stops periodic polling. No-op when not running. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.logger.info({ instanceId: this.instanceId }, 'scheduler.stopped');
  }

  private async requireJob(id: string): Promise<ScheduledJob> {
    const job = await this.repository.get(id);
    if (job === null) {
      throw new SchedulerNotFoundError(`Scheduled job "${id}" does not exist`);
    }
    return job;
  }

  private async runAttempt(job: ScheduledJob, now: Date): Promise<JobRunResult> {
    const owner = this.instanceId;
    const key = `scheduler:job:${job.id}`;
    const acquired = await this.lock.acquire(key, owner, this.lockTtlMs);
    if (!acquired.acquired) {
      this.metrics.locksContended(1);
      this.metrics.jobsSkipped(1);
      await this.emit('scheduler.job.skipped', job, { reason: 'lock.contended' });
      return { run: null, job, outcome: 'skipped' };
    }
    this.metrics.setLocksHeld(1);

    const attempt = job.attempts + 1;
    const run: JobRun = {
      id: randomUUID(),
      jobId: job.id,
      status: 'running',
      attempt,
      scheduledFor: now,
      startedAt: now,
      finishedAt: null,
      error: null,
      result: null,
      lockOwner: owner,
    };
    const runningJob: ScheduledJob = {
      ...job,
      status: 'running',
      attempts: attempt,
      lastRunAt: now,
      updatedAt: now,
    };

    try {
      await this.repository.saveRun(run);
      await this.repository.update(runningJob);
      await this.emit('scheduler.job.started', runningJob, { attempt });
      const startedAt = this.now();
      const result = await this.execute(job, run);
      const finishedAt = this.now();
      this.metrics.observeRunDurationMs(finishedAt.getTime() - startedAt.getTime());

      const successRun: JobRun = {
        ...run,
        status: 'succeeded',
        finishedAt,
        result: { ok: true },
      };
      await this.repository.updateRun(successRun);
      this.metrics.jobsCompleted(1);
      await this.emit('scheduler.job.succeeded', runningJob, {
        runId: run.id,
        attempt,
      });
      const finalized = await this.finalizeSuccess(runningJob, finishedAt);
      return { run: successRun, job: finalized, outcome: 'succeeded', result };
    } catch (err) {
      const finishedAt = this.now();
      const message = err instanceof Error ? err.message : 'job failed';
      const failedRun: JobRun = {
        ...run,
        status: 'failed',
        finishedAt,
        error: message,
      };
      await this.repository.updateRun(failedRun);

      if (this.shouldRetry(job, attempt, err)) {
        const backoffMs = Math.min(
          job.retryBackoffMs * 2 ** (attempt - 1),
          MAX_BACKOFF_MS,
        );
        const nextRunAt = new Date(finishedAt.getTime() + backoffMs);
        const retried: ScheduledJob = {
          ...job,
          status: 'pending',
          nextRunAt,
          attempts: attempt,
          lastRunAt: finishedAt,
          lastStatus: 'failed',
          updatedAt: finishedAt,
        };
        await this.repository.update(retried);
        this.metrics.jobsRetried(1);
        await this.emit('scheduler.job.retrying', retried, {
          runId: run.id,
          attempt,
          error: message,
        });
        return { run: failedRun, job: retried, outcome: 'retrying' };
      }

      this.metrics.jobsFailed(1);
      await this.emit('scheduler.job.failed', runningJob, {
        runId: run.id,
        error: message,
      });
      const finalized = await this.finalizeFailure(runningJob, finishedAt);
      return { run: failedRun, job: finalized, outcome: 'failed' };
    } finally {
      await this.lock.release(key, owner);
      this.metrics.setLocksHeld(0);
    }
  }

  private async execute(job: ScheduledJob, run: JobRun): Promise<unknown> {
    const handler = this.handlers.get(job.kind);
    if (handler === null) {
      throw new MissingHandlerError(
        `No handler registered for job kind "${job.kind}"`,
        { jobId: job.id, jobKind: job.kind, attempt: run.attempt },
      );
    }
    const input: JobExecutionInput = { job, payload: job.payload };
    return this.withTimeout(() => handler.execute(input), job.timeoutMs, job);
  }

  private async withTimeout(
    task: () => Promise<unknown>,
    timeoutMs: number | null,
    job: ScheduledJob,
  ): Promise<unknown> {
    if (timeoutMs === null || timeoutMs <= 0) return task();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new JobTimeoutError(
            `Job "${job.name}" timed out after ${timeoutMs}ms`,
            { jobId: job.id, jobKind: job.kind },
            timeoutMs,
          ),
        );
      }, timeoutMs);
    });
    try {
      return await Promise.race([task(), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private shouldRetry(job: ScheduledJob, attempt: number, err: unknown): boolean {
    if (isAppError(err) && err.retryable === false) return false;
    return attempt <= job.maxRetries;
  }

  /** Advances a recurring job to its next occurrence; finishes one-shot jobs. */
  private async finalizeSuccess(
    job: ScheduledJob,
    finishedAt: Date,
  ): Promise<ScheduledJob> {
    if (job.cron !== null) {
      const next = parseCron(job.cron).nextAfter(finishedAt);
      if (next !== null) {
        const updated: ScheduledJob = {
          ...job,
          status: 'pending',
          nextRunAt: next,
          lastStatus: 'succeeded',
          updatedAt: finishedAt,
        };
        return this.repository.update(updated);
      }
    }
    return this.finish(job, finishedAt, 'succeeded');
  }

  /**
   * Marks a terminal failure. Recurring jobs keep their schedule (a missed
   * run is recorded as a failed run, the next occurrence still fires);
   * one-shot jobs are finished.
   */
  private async finalizeFailure(
    job: ScheduledJob,
    finishedAt: Date,
  ): Promise<ScheduledJob> {
    if (job.cron !== null) {
      const next = parseCron(job.cron).nextAfter(finishedAt);
      if (next !== null) {
        const updated: ScheduledJob = {
          ...job,
          status: 'pending',
          nextRunAt: next,
          lastStatus: 'failed',
          updatedAt: finishedAt,
        };
        return this.repository.update(updated);
      }
    }
    return this.finish(job, finishedAt, 'failed');
  }

  private async finish(
    job: ScheduledJob,
    finishedAt: Date,
    status: 'succeeded' | 'failed',
  ): Promise<ScheduledJob> {
    const finished: ScheduledJob = {
      ...job,
      status,
      nextRunAt: null,
      finishedAt,
      lastStatus: status,
      updatedAt: finishedAt,
    };
    return this.repository.update(finished);
  }

  private async emit(
    type: SchedulerEventType,
    job: ScheduledJob,
    extra: {
      attempt?: number;
      error?: string;
      reason?: string;
      runId?: string;
    } = {},
  ): Promise<void> {
    if (this.eventPublisher === undefined) return;
    try {
      await this.eventPublisher.publish({
        type,
        jobId: job.id,
        kind: job.kind,
        name: job.name,
        priority: job.priority,
        storeId: job.storeId,
        ...extra,
      });
    } catch (err) {
      this.logger.warn({ err, type, jobId: job.id }, 'scheduler.event-publish-failed');
    }
  }
}

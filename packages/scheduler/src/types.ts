/**
 * Core domain models for the autonomous scheduler.
 *
 * The scheduler persists {@link ScheduledJob}s, fires them on a cron or
 * one-shot schedule, runs them through registered {@link JobHandler}s with
 * priority ordering, retries and a distributed lock, and records every
 * attempt as a {@link JobRun}.
 */

/** The kinds of work the scheduler knows about out of the box. */
export type JobKind = 'crawl' | 'analysis' | 'execution';

export const JOB_KINDS = ['crawl', 'analysis', 'execution'] as const;

/** Priority bucket; higher priority jobs leave the queue first. */
export type JobPriority = 'critical' | 'high' | 'normal' | 'low';

export const JOB_PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;

/**
 * Lifecycle of a scheduled job. Jobs are `pending` while waiting for their
 * next run, `running` while an attempt is in flight and `succeeded` or
 * `failed` once terminal. `cancelled` marks a job the operator stopped.
 */
export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** Lifecycle of a single attempt. */
export type JobRunStatus = 'running' | 'succeeded' | 'failed';

/** Outcome of a single attempt as reported to the caller. */
export type AttemptOutcome = 'succeeded' | 'failed' | 'retrying' | 'skipped';

export interface JobFilter {
  kind?: JobKind;
  status?: JobStatus;
  storeId?: string;
  enabled?: boolean;
}

/**
 * A persisted job. Either `cron` (recurring) or `runsAt` (one-shot) is set;
 * `nextRunAt` mirrors the next computed fire time so the repository can
 * select due jobs without evaluating cron expressions.
 */
export interface ScheduledJob {
  id: string;
  kind: JobKind;
  /** Human-readable name, e.g. `daily-store-crawl`. */
  name: string;
  storeId: string | null;
  /** 5- or 6-field cron expression; `null` for one-shot jobs. */
  cron: string | null;
  timezone: string | null;
  priority: JobPriority;
  payload: Record<string, unknown> | null;
  maxRetries: number;
  /** Base backoff before the next attempt; doubles per retry. */
  retryBackoffMs: number;
  /** Optional per-attempt timeout; `null` disables the timeout. */
  timeoutMs: number | null;
  enabled: boolean;
  status: JobStatus;
  /** Completed attempts so far. */
  attempts: number;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: JobRunStatus | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

/** Input for creating a job. */
export interface ScheduleJobInput {
  kind: JobKind;
  name: string;
  storeId?: string;
  /** Recurring schedule; mutually exclusive with `runsAt`. */
  cron?: string;
  /** One-shot fire time; mutually exclusive with `cron`. */
  runsAt?: Date;
  timezone?: string;
  priority?: JobPriority;
  payload?: Record<string, unknown>;
  maxRetries?: number;
  retryBackoffMs?: number;
  timeoutMs?: number;
}

/** Partial update applied by {@link AutonomousScheduler.update}. */
export interface UpdateJobInput {
  name?: string;
  cron?: string | null;
  /** Switches a job to one-shot firing at the given time. */
  runsAt?: Date | null;
  timezone?: string | null;
  priority?: JobPriority;
  payload?: Record<string, unknown> | null;
  maxRetries?: number;
  retryBackoffMs?: number;
  timeoutMs?: number | null;
  enabled?: boolean;
}

/** A single attempt at running a job. */
export interface JobRun {
  id: string;
  jobId: string;
  status: JobRunStatus;
  attempt: number;
  scheduledFor: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  result: Record<string, unknown> | null;
  /** Instance id that held the lock while this run executed. */
  lockOwner: string | null;
}

export interface JobRunResult {
  /** `null` when the attempt never started (lock contention). */
  run: JobRun | null;
  job: ScheduledJob;
  outcome: AttemptOutcome;
  /** Return value of the handler on success. */
  result?: unknown;
}

export interface SchedulerRunSummary {
  now: Date;
  /** Jobs that were due at tick time. */
  due: number;
  /** Attempts that actually started. */
  processed: number;
  succeeded: number;
  failed: number;
  retried: number;
  skipped: number;
  attempts: JobRunResult[];
}

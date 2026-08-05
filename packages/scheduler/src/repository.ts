/**
 * Persistence seam for scheduled jobs and their runs.
 *
 * The scheduler depends on the {@link JobRepository} interface — not on a
 * specific store — so the platform can back it with Postgres while tests use
 * the in-memory implementation. `nextDue` is the only query the runner needs:
 * enabled, pending jobs whose `nextRunAt` has arrived, in priority order.
 */

import type { JobFilter, JobPriority, JobRun, ScheduledJob } from './types.js';

export interface JobRepository {
  save(job: ScheduledJob): Promise<void>;
  get(id: string): Promise<ScheduledJob | null>;
  list(filter?: JobFilter): Promise<ScheduledJob[]>;
  /** Persists an updated job and returns the stored copy. */
  update(job: ScheduledJob): Promise<ScheduledJob>;
  delete(id: string): Promise<boolean>;
  /**
   * Returns up to `limit` enabled, pending jobs that are due at `now`,
   * ordered by priority (critical first) then next fire time.
   */
  nextDue(now: Date, limit?: number): Promise<ScheduledJob[]>;
  saveRun(run: JobRun): Promise<void>;
  getRun(id: string): Promise<JobRun | null>;
  listRuns(jobId: string): Promise<JobRun[]>;
  updateRun(run: JobRun): Promise<void>;
}

const PRIORITY_ORDER: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function matchesFilter(job: ScheduledJob, filter: JobFilter): boolean {
  if (filter.kind !== undefined && job.kind !== filter.kind) return false;
  if (filter.status !== undefined && job.status !== filter.status) return false;
  if (filter.storeId !== undefined && job.storeId !== filter.storeId) return false;
  if (filter.enabled !== undefined && job.enabled !== filter.enabled) return false;
  return true;
}

function sortForQueue(a: ScheduledJob, b: ScheduledJob): number {
  const priorityA = PRIORITY_ORDER[a.priority];
  const priorityB = PRIORITY_ORDER[b.priority];
  if (priorityA !== priorityB) return priorityA - priorityB;
  const dueA = a.nextRunAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const dueB = b.nextRunAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (dueA !== dueB) return dueA - dueB;
  return a.id.localeCompare(b.id);
}

/**
 * In-memory {@link JobRepository} for tests and single-process deployments.
 * Not safe to share across processes.
 */
export class MemoryJobRepository implements JobRepository {
  private readonly jobs = new Map<string, ScheduledJob>();
  private readonly runs = new Map<string, JobRun>();

  async save(job: ScheduledJob): Promise<void> {
    this.jobs.set(job.id, { ...job });
  }

  async get(id: string): Promise<ScheduledJob | null> {
    const job = this.jobs.get(id);
    return job === undefined ? null : { ...job };
  }

  async list(filter: JobFilter = {}): Promise<ScheduledJob[]> {
    return [...this.jobs.values()]
      .filter((job) => matchesFilter(job, filter))
      .map((job) => ({ ...job }))
      .sort(sortForQueue);
  }

  async update(job: ScheduledJob): Promise<ScheduledJob> {
    const stored: ScheduledJob = { ...job };
    this.jobs.set(job.id, stored);
    return { ...stored };
  }

  async delete(id: string): Promise<boolean> {
    return this.jobs.delete(id);
  }

  async nextDue(now: Date, limit = 100): Promise<ScheduledJob[]> {
    const due: ScheduledJob[] = [];
    for (const job of this.jobs.values()) {
      if (!job.enabled || job.status !== 'pending' || job.nextRunAt === null) continue;
      if (job.nextRunAt.getTime() <= now.getTime()) due.push({ ...job });
    }
    due.sort(sortForQueue);
    return due.slice(0, limit);
  }

  async saveRun(run: JobRun): Promise<void> {
    this.runs.set(run.id, { ...run });
  }

  async getRun(id: string): Promise<JobRun | null> {
    const run = this.runs.get(id);
    return run === undefined ? null : { ...run };
  }

  async listRuns(jobId: string): Promise<JobRun[]> {
    return [...this.runs.values()]
      .filter((run) => run.jobId === jobId)
      .map((run) => ({ ...run }))
      .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
  }

  async updateRun(run: JobRun): Promise<void> {
    this.runs.set(run.id, { ...run });
  }
}

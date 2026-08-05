/**
 * Job handlers: the bridge between the scheduler and real work.
 *
 * The scheduler itself knows nothing about crawling, SEO analysis or
 * execution engines. A {@link JobHandler} is registered per {@link JobKind}
 * and receives the job plus its validated payload. The factory helpers below
 * produce handlers for the three built-in kinds and enforce the payload
 * contract each kind requires, so a malformed job fails fast with a
 * {@link SchedulerValidationError} instead of crashing the runner.
 */

import { SchedulerValidationError } from './errors.js';
import type { JobKind, ScheduledJob } from './types.js';

export interface JobExecutionInput {
  job: ScheduledJob;
  payload: Record<string, unknown> | null;
}

export interface JobHandler {
  readonly kind: JobKind;
  execute(input: JobExecutionInput): Promise<unknown>;
}

/** Registry mapping job kinds to their handlers. */
export class JobHandlerRegistry {
  private readonly handlers = new Map<JobKind, JobHandler>();

  register(handler: JobHandler): void {
    this.handlers.set(handler.kind, handler);
  }

  get(kind: JobKind): JobHandler | null {
    return this.handlers.get(kind) ?? null;
  }

  supports(kind: JobKind): boolean {
    return this.handlers.has(kind);
  }

  remove(kind: JobKind): boolean {
    return this.handlers.delete(kind);
  }

  list(): JobHandler[] {
    return [...this.handlers.values()];
  }
}

function requirePayload(job: ScheduledJob, payload: Record<string, unknown> | null): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SchedulerValidationError(
      `Job "${job.name}" requires a JSON payload`,
      { jobId: job.id, jobKind: job.kind },
    );
  }
  return payload;
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value === '') {
    throw new SchedulerValidationError(
      `Job payload field "${key}" must be a non-empty string`,
    );
  }
  return value;
}

function missingField(key: string): SchedulerValidationError {
  return new SchedulerValidationError(`Job payload is missing required field "${key}"`);
}

/**
 * Handler for recurring crawls. Requires `payload.storeId` (the Shopify store
 * to crawl) and `payload.seeds` (an array of start URLs).
 */
export function crawlJobHandler(
  execute: (input: { storeId: string; seeds: string[] }) => Promise<unknown>,
): JobHandler {
  return {
    kind: 'crawl',
    async execute({ job, payload }) {
      const input = requirePayload(job, payload);
      if (!('storeId' in input)) throw missingField('storeId');
      if (!('seeds' in input)) throw missingField('seeds');
      const storeId = requireString(input, 'storeId');
      const seeds = input.seeds;
      if (!Array.isArray(seeds) || seeds.length === 0 || !seeds.every((seed) => typeof seed === 'string')) {
        throw new SchedulerValidationError(
          'Job payload field "seeds" must be a non-empty array of strings',
        );
      }
      return execute({ storeId, seeds: seeds as string[] });
    },
  };
}

/**
 * Handler for SEO analysis. Requires `payload.storeId`; `payload.crawlJobId`
 * optionally pins the analysis to a specific crawl run.
 */
export function analysisJobHandler(
  execute: (input: { storeId: string; crawlJobId?: string }) => Promise<unknown>,
): JobHandler {
  return {
    kind: 'analysis',
    async execute({ job, payload }) {
      const input = requirePayload(job, payload);
      if (!('storeId' in input)) throw missingField('storeId');
      const storeId = requireString(input, 'storeId');
      const crawlJobId = 'crawlJobId' in input ? requireString(input, 'crawlJobId') : undefined;
      return execute({ storeId, crawlJobId });
    },
  };
}

/**
 * Handler for executing approved change plans. Requires `payload.executionPlan`
 * (the plan object the execution engine understands); `payload.storeId` is
 * optional and passed through when present.
 */
export function executionJobHandler(
  execute: (input: { storeId?: string; executionPlan: unknown }) => Promise<unknown>,
): JobHandler {
  return {
    kind: 'execution',
    async execute({ job, payload }) {
      const input = requirePayload(job, payload);
      if (!('executionPlan' in input)) throw missingField('executionPlan');
      const storeId = 'storeId' in input ? requireString(input, 'storeId') : undefined;
      return execute({ storeId, executionPlan: input.executionPlan });
    },
  };
}

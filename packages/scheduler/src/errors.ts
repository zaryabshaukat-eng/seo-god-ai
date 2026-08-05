/**
 * Typed error hierarchy for scheduler failures.
 *
 * Every error extends the platform-wide {@link AppError} so loggers,
 * monitoring and the API layer handle failures uniformly, while keeping
 * scheduler-specific codes and context.
 */

import { AppError, ConflictError, NotFoundError, ValidationError } from '@seogod/core';

export type SchedulerErrorCode =
  | 'cron.invalid'
  | 'job.timeout'
  | 'lock.acquire'
  | 'job.running'
  | 'handler.missing';

export interface SchedulerErrorContext extends Record<string, unknown> {
  jobId?: string;
  jobKind?: string;
  name?: string;
  attempt?: number;
}

export class SchedulerError extends AppError {
  declare readonly code: SchedulerErrorCode;
  declare readonly context: SchedulerErrorContext;

  constructor(
    message: string,
    options: {
      code: SchedulerErrorCode;
      context?: SchedulerErrorContext;
      cause?: unknown;
      requestId?: string;
    },
  ) {
    super(message, {
      code: options.code,
      context: options.context,
      cause: options.cause,
      requestId: options.requestId,
    });
  }
}

/** A cron expression could not be parsed. */
export class CronValidationError extends SchedulerError {
  constructor(message: string, context?: SchedulerErrorContext) {
    super(message, { code: 'cron.invalid', context });
  }
}

/** A handler exceeded its allotted time. */
export class JobTimeoutError extends SchedulerError {
  readonly timeoutMs: number;

  constructor(message: string, context: SchedulerErrorContext, timeoutMs: number) {
    super(message, { code: 'job.timeout', context });
    this.timeoutMs = timeoutMs;
  }
}

/** The distributed lock could not be acquired. */
export class LockAcquireError extends SchedulerError {
  constructor(message: string, context?: SchedulerErrorContext) {
    super(message, { code: 'lock.acquire', context });
  }
}

/** A job was already running and cannot be re-run. */
export class JobRunningError extends SchedulerError {
  constructor(message: string, context?: SchedulerErrorContext) {
    super(message, { code: 'job.running', context });
  }
}

/** No handler is registered for a job's kind. */
export class MissingHandlerError extends SchedulerError {
  constructor(message: string, context?: SchedulerErrorContext) {
    super(message, { code: 'handler.missing', context });
  }
}

/** A job id did not match a persisted job. */
export class SchedulerNotFoundError extends NotFoundError {
  constructor(message: string, context?: SchedulerErrorContext) {
    super(message, { module: 'scheduler', operation: 'scheduler.job', context });
  }
}

/** Scheduling input was invalid (bad cron, conflicting schedule, bad payload). */
export class SchedulerValidationError extends ValidationError {
  constructor(message: string, context?: SchedulerErrorContext) {
    super(message, { module: 'scheduler', operation: 'scheduler.schedule', context });
  }
}

/** Two jobs tried to mutate the same resource exclusively. */
export class SchedulerConflictError extends ConflictError {
  constructor(message: string, context?: SchedulerErrorContext) {
    super(message, { module: 'scheduler', operation: 'scheduler.job', context });
  }
}

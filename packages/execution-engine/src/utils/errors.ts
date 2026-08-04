import { AppError } from '@seogod/core';
import type { ErrorOptions } from '@seogod/core';

export const ExecutionErrorCodes = {
  execution: 'execution.error',
  invalid: 'execution.invalid',
  unsupported: 'execution.unsupported',
  safety: 'execution.safety_violation',
  locked: 'execution.store_locked',
  cancelled: 'execution.cancelled',
  timeout: 'execution.timeout',
  rollback: 'execution.rollback',
  concurrency: 'execution.concurrency',
  approval: 'execution.approval_required',
  queue: 'execution.queue',
  rateLimit: 'execution.rate_limited',
} as const;

export type ExecutionErrorCode = (typeof ExecutionErrorCodes)[keyof typeof ExecutionErrorCodes];

/** Base class for every execution-engine failure. */
export class ExecutionError extends AppError {
  constructor(message: string, code: ExecutionErrorCode, options: ErrorOptions = {}) {
    super(message, { ...options, code });
  }
}

export function isExecutionError(error: unknown): error is ExecutionError {
  return error instanceof ExecutionError;
}

/** The input or execution is not valid enough to run. */
export class InvalidExecutionError extends ExecutionError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, ExecutionErrorCodes.invalid, options);
  }
}

/** No operation/writer exists for the requested action. */
export class UnsupportedExecutionError extends ExecutionError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, ExecutionErrorCodes.unsupported, options);
  }
}

/** A safety rule blocked the execution (kill switch, rejected action, etc.). */
export class SafetyViolationError extends ExecutionError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, ExecutionErrorCodes.safety, options);
  }
}

/** The store is already locked by another execution. */
export class StoreLockedError extends ExecutionError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, ExecutionErrorCodes.locked, options);
  }
}

/** The execution was cancelled before it completed. */
export class ExecutionCancelledError extends ExecutionError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, ExecutionErrorCodes.cancelled, options);
  }
}

/** A step exceeded its configured timeout. */
export class ExecutionTimeoutError extends ExecutionError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, ExecutionErrorCodes.timeout, options);
  }
}

/** A rollback failed. */
export class RollbackError extends ExecutionError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, ExecutionErrorCodes.rollback, options);
  }
}

/** Two executions conflict over the same store or resource. */
export class ConcurrencyError extends ExecutionError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, ExecutionErrorCodes.concurrency, options);
  }
}

/** A step requires approval that has not been granted. */
export class ApprovalRequiredError extends ExecutionError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, ExecutionErrorCodes.approval, options);
  }
}

/** The execution hit a rate limit it cannot recover from. */
export class ExecutionRateLimitError extends ExecutionError {
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: ErrorOptions & { retryAfterSeconds?: number } = {}) {
    super(message, ExecutionErrorCodes.rateLimit, options);
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

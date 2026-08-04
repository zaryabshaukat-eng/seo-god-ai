import { describe, expect, it } from 'vitest';
import { AppError } from '@seogod/core';
import {
  ApprovalRequiredError,
  ConcurrencyError,
  ExecutionCancelledError,
  ExecutionError,
  ExecutionErrorCodes,
  ExecutionRateLimitError,
  ExecutionTimeoutError,
  InvalidExecutionError,
  RollbackError,
  SafetyViolationError,
  StoreLockedError,
  UnsupportedExecutionError,
  isExecutionError,
} from './errors.js';

describe('execution errors', () => {
  it('ExecutionError is an AppError with a stable code', () => {
    const error = new ExecutionError('boom', ExecutionErrorCodes.execution, { module: 'execution-engine' });
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('execution.error');
    expect(error.module).toBe('execution-engine');
    expect(isExecutionError(error)).toBe(true);
  });

  it('every subclass carries its own code and defaults to empty options', () => {
    const cases: Array<[ExecutionError, string]> = [
      [new InvalidExecutionError('x'), ExecutionErrorCodes.invalid],
      [new UnsupportedExecutionError('x'), ExecutionErrorCodes.unsupported],
      [new SafetyViolationError('x'), ExecutionErrorCodes.safety],
      [new StoreLockedError('x'), ExecutionErrorCodes.locked],
      [new ExecutionCancelledError('x'), ExecutionErrorCodes.cancelled],
      [new ExecutionTimeoutError('x'), ExecutionErrorCodes.timeout],
      [new RollbackError('x'), ExecutionErrorCodes.rollback],
      [new ConcurrencyError('x'), ExecutionErrorCodes.concurrency],
      [new ApprovalRequiredError('x'), ExecutionErrorCodes.approval],
    ];
    for (const [error, code] of cases) {
      expect(error.code).toBe(code);
      expect(error.message).toBe('x');
    }
  });

  it('ExecutionRateLimitError carries retryAfterSeconds', () => {
    const error = new ExecutionRateLimitError('slow down', { retryAfterSeconds: 5 });
    expect(error.code).toBe(ExecutionErrorCodes.rateLimit);
    expect(error.retryAfterSeconds).toBe(5);
    const plain = new ExecutionRateLimitError('slow down');
    expect(plain.retryAfterSeconds).toBeUndefined();
  });

  it('isExecutionError rejects plain errors and null', () => {
    expect(isExecutionError(new Error('plain'))).toBe(false);
    expect(isExecutionError(null)).toBe(false);
    expect(isExecutionError(new InvalidExecutionError('x'))).toBe(true);
  });
});

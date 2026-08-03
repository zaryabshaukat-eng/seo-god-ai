import { describe, expect, it } from 'vitest';
import {
  OrchestratorError,
  SafetyViolationError,
  TimeoutError,
  ValidationFailedError,
} from '../errors.js';
import { backoffDelay, errorMessage, isRetryable } from './retry.js';

describe('isRetryable', () => {
  it('never retries validation or safety failures', () => {
    expect(isRetryable(new ValidationFailedError('bad output', {}))).toBe(false);
    expect(isRetryable(new SafetyViolationError('blocked', {}))).toBe(false);
  });

  it('retries plain errors and non-AppError values', () => {
    expect(isRetryable(new Error('boom'))).toBe(true);
    expect(isRetryable('boom')).toBe(true);
  });

  it('honours the retryable flag of core AppErrors', () => {
    expect(isRetryable(new TimeoutError('timeout'))).toBe(true);
    expect(isRetryable(new OrchestratorError('generic'))).toBe(false);
  });
});

describe('errorMessage', () => {
  it('uses the message for Error instances and stringifies other values', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('boom')).toBe('boom');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and caps at the maximum', () => {
    expect(backoffDelay(1, { baseMs: 100, maxMs: 4000 })).toBe(100);
    expect(backoffDelay(2, { baseMs: 100, maxMs: 4000 })).toBe(200);
    expect(backoffDelay(10, { baseMs: 100, maxMs: 4000 })).toBe(4000);
  });

  it('defaults to base 100 / max 4000 and supports jitter bounds', () => {
    expect(backoffDelay(1)).toBe(100);
    const jittered = backoffDelay(2, { baseMs: 100, maxMs: 4000, jitter: true });
    expect(jittered).toBeGreaterThanOrEqual(100);
    expect(jittered).toBeLessThanOrEqual(400);
  });

  it('never grows beyond max even with a tiny max', () => {
    expect(backoffDelay(5, { baseMs: 100, maxMs: 150 })).toBe(150);
  });
});

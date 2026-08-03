import { isAppError } from '@seogod/core';
import { SafetyViolationError, ValidationFailedError } from '../errors.js';

/**
 * Decides whether a failed step/call should be retried. Validation and
 * safety failures are never retried (the input is broken, not transient);
 * core retryable errors and plain errors are retried.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ValidationFailedError || error instanceof SafetyViolationError) {
    return false;
  }
  if (isAppError(error)) return error.retryable;
  return true;
}

/** Normalizes any thrown value into a stable message. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  jitter?: boolean;
}

/** Exponential backoff delay: `base * 2^(attempt-1)`, capped at `maxMs`. */
export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 100;
  const max = options.maxMs ?? 4000;
  const factor = Math.min(2 ** Math.max(0, attempt - 1), max / base);
  const delay = base * factor;
  if (options.jitter === true) return Math.floor(delay / 2 + Math.random() * delay);
  return Math.min(delay, max);
}

import type { RetryPolicy } from '../types/queue.js';

export interface RetryPolicyOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
}

export function buildRetryPolicy(options: RetryPolicyOptions = {}): RetryPolicy {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const backoffFactor = options.backoffFactor ?? 2;
  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    backoffFactor,
    delayFor(attemptNumber: number): number {
      const n = Math.max(1, attemptNumber);
      return Math.min(maxDelayMs, Math.max(1, baseDelayMs * backoffFactor ** (n - 1)));
    },
    isExhausted(attemptNumber: number): boolean {
      return attemptNumber >= maxAttempts;
    },
  };
}

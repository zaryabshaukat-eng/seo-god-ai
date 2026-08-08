/**
 * In-memory fixed-window rate limiter. Each key (typically `ip:route`) is
 * bounded to `max` requests per `windowMs`; excess calls are rejected with the
 * window reset time so middleware can set `Retry-After`.
 */

import { RateLimitError } from './errors.js';

export interface RateLimiterOptions {
  /** Window length in milliseconds. */
  windowMs?: number;
  /** Maximum requests per window per key. */
  max?: number;
  /** Clock injection for deterministic tests. */
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

export class SlidingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly now: () => number;
  private readonly windows = new Map<string, WindowEntry>();

  constructor(options: RateLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? 60_000;
    this.max = options.max ?? 100;
    this.now = options.now ?? (() => Date.now());
  }

  /** Records one hit for `key` and reports whether it is allowed. */
  hit(key: string): RateLimitDecision {
    const timestamp = this.now();
    const current = this.windows.get(key);
    if (current === undefined || timestamp >= current.resetAt) {
      const resetAt = timestamp + this.windowMs;
      this.windows.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: this.max - 1, resetAt, retryAfterMs: 0 };
    }
    if (current.count >= this.max) {
      const retryAfterMs = Math.max(1, current.resetAt - timestamp);
      return { allowed: false, remaining: 0, resetAt: current.resetAt, retryAfterMs };
    }
    current.count += 1;
    return { allowed: true, remaining: this.max - current.count, resetAt: current.resetAt, retryAfterMs: 0 };
  }

  /** Removes all state (used by tests and on reset). */
  reset(): void {
    this.windows.clear();
  }

  /** Number of tracked keys. */
  get size(): number {
    return this.windows.size;
  }
}

/** Rate-limits by key; throws `RateLimitError` when the budget is exhausted. */
export function enforceLimit(limiter: SlidingWindowRateLimiter, key: string): RateLimitDecision {
  const decision = limiter.hit(key);
  if (!decision.allowed) {
    throw new RateLimitError(`Too many requests. Retry after ${decision.retryAfterMs}ms.`, decision.retryAfterMs);
  }
  return decision;
}

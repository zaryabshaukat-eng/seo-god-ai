export interface RateLimiterOptions {
  /** Minimum spacing between request starts in milliseconds. */
  rateLimitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Throttles requests so the crawler never fires faster than the configured
 * rate limit. `acquire` blocks until the previous request slot has elapsed.
 */
export class RateLimiter {
  private readonly now: () => number;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private lastSlotMs = Number.NEGATIVE_INFINITY;
  private rateLimitMsValue: number;

  constructor(options: RateLimiterOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.sleepImpl = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.rateLimitMsValue = options.rateLimitMs ?? 0;
  }

  /** Waits until the next allowed request slot. */
  async acquire(): Promise<void> {
    const waitMs = this.pendingDelayMs();
    if (waitMs > 0) await this.sleepImpl(waitMs);
    this.lastSlotMs = this.now();
  }

  /** How long the next `acquire` would need to wait (for tests/metrics). */
  pendingDelayMs(): number {
    const elapsed = this.now() - this.lastSlotMs;
    return Math.max(0, this.rateLimitMsValue - elapsed);
  }

  /** Updates the spacing between requests. */
  setRateLimitMs(rateLimitMs: number): void {
    this.rateLimitMsValue = Math.max(0, rateLimitMs);
  }
}

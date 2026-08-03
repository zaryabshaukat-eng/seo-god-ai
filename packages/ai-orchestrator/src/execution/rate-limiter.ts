export interface RateLimiterOptions {
  /** Max calls per second (0 disables limiting). */
  maxPerSecond?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Enforces a minimum spacing between calls (rate limit). Sequential spacing
 * keeps providers happy without bursts; injectable clock + sleep keep tests
 * deterministic and fast.
 */
export class RateLimiter {
  private readonly maxPerSecond: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private nextAllowedAt = 0;
  private calls = 0;

  constructor(options: RateLimiterOptions = {}) {
    this.maxPerSecond = options.maxPerSecond ?? 0;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  get isLimited(): boolean {
    return this.maxPerSecond > 0;
  }

  /** Waits until this call is allowed by the rate window. */
  async acquire(): Promise<void> {
    if (!this.isLimited) return;
    this.calls += 1;
    const intervalMs = Math.max(1, Math.floor(1000 / this.maxPerSecond));
    const now = this.now();
    const start = Math.max(now, this.nextAllowedAt);
    const waitMs = start - now;
    if (waitMs > 0) await this.sleep(waitMs);
    this.nextAllowedAt = start + intervalMs;
  }
}

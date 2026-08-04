export interface RateLimiterOptions {
  /** Maximum API calls allowed per rolling 60s window per store. */
  perMinute: number;
  nowMs?: () => number;
  windowMs?: number;
}

/**
 * Sliding-window write rate limiter, per store. Validators use `canAcquire`
 * to gate execution; the publisher uses `waitMs` + `consume` to honor Shopify
 * rate limits before issuing writes.
 */
export class RateLimiter {
  private readonly perMinute: number;
  private readonly windowMs: number;
  private readonly nowMs: () => number;
  private readonly calls = new Map<string, number[]>();

  constructor(options: RateLimiterOptions) {
    this.perMinute = Math.max(1, options.perMinute);
    this.windowMs = options.windowMs ?? 60_000;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  canAcquire(storeId: string, count = 1): boolean {
    const window = this.activeWindow(storeId);
    return window.length + count <= this.perMinute;
  }

  /** Milliseconds until `count` new calls fit in the current window. */
  waitMs(storeId: string, count = 1): number {
    const window = this.activeWindow(storeId);
    if (window.length + count <= this.perMinute) return 0;
    const overflow = window.length + count - this.perMinute;
    const sorted = [...window].sort((a, b) => a - b);
    const oldest = sorted[overflow - 1];
    if (oldest === undefined) return 0;
    return Math.max(0, oldest + this.windowMs - this.nowMs());
  }

  remaining(storeId: string): number {
    const window = this.activeWindow(storeId);
    return Math.max(0, this.perMinute - window.length);
  }

  consume(storeId: string, count = 1): void {
    const now = this.nowMs();
    const window = this.calls.get(storeId) ?? [];
    for (let i = 0; i < count; i += 1) {
      window.push(now);
    }
    this.calls.set(storeId, window);
  }

  reset(): void {
    this.calls.clear();
  }

  private activeWindow(storeId: string): number[] {
    const now = this.nowMs();
    const window = this.calls.get(storeId) ?? [];
    const fresh = window.filter((ts) => ts + this.windowMs > now);
    if (fresh.length !== window.length) {
      if (fresh.length === 0) {
        this.calls.delete(storeId);
      } else {
        this.calls.set(storeId, fresh);
      }
    }
    return fresh;
  }
}

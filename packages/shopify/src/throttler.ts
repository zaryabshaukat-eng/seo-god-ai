import { sleep } from './sleep.js';

export interface RateThrottlerOptions {
  /**
   * Fraction of the API bucket that triggers a short wait before sending,
   * e.g. 0.85 = wait once the bucket is 85% full. Default 0.85.
   */
  threshold?: number;
  /**
   * How long to pause when the bucket is full. Shopify GraphQL buckets
   * reset roughly every second, so the default is 1000 ms.
   */
  bucketResetMs?: number;
}

/**
 * Tracks Shopify's `X-Shopify-Shop-Api-Call-Limit` header (`38/40`) and
 * pauses requests before they hit the ceiling. One instance should be
 * shared by every request for the same store so the bucket stays accurate.
 */
export class RateThrottler {
  private readonly threshold: number;
  private readonly bucketResetMs: number;
  private current = 0;
  private max = 40;

  constructor(options: RateThrottlerOptions = {}) {
    this.threshold = options.threshold ?? 0.85;
    this.bucketResetMs = options.bucketResetMs ?? 1000;
  }

  /** Update the tracked bucket from a raw call-limit header value. */
  update(callLimitHeader: string | null): void {
    if (!callLimitHeader) {
      return;
    }
    const match = /^(\d+)\/(\d+)$/.exec(callLimitHeader.trim());
    if (!match) {
      return;
    }
    this.current = Number(match[1]);
    this.max = Number(match[2]);
  }

  /** Fraction of the bucket currently used, `0..1` (or `0` before any call). */
  get usage(): number {
    return this.max > 0 ? this.current / this.max : 0;
  }

  /** Resolves immediately when under the threshold, otherwise after a pause. */
  async waitIfNeeded(): Promise<void> {
    if (this.usage >= this.threshold) {
      await sleep(this.bucketResetMs);
    }
  }
}

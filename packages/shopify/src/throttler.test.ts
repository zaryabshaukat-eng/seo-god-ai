import { describe, expect, it } from 'vitest';
import { RateThrottler } from './throttler.js';

describe('RateThrottler', () => {
  it('starts with no usage', () => {
    expect(new RateThrottler().usage).toBe(0);
  });

  it('parses the call-limit header', () => {
    const throttler = new RateThrottler();
    throttler.update('38/40');
    expect(throttler.usage).toBeCloseTo(0.95);
  });

  it('ignores malformed headers', () => {
    const throttler = new RateThrottler();
    throttler.update('garbage');
    expect(throttler.usage).toBe(0);
    throttler.update(null);
    expect(throttler.usage).toBe(0);
  });

  it('does not wait when under the threshold', async () => {
    const throttler = new RateThrottler({ threshold: 0.85, bucketResetMs: 25 });
    throttler.update('30/40');
    await expect(throttler.waitIfNeeded()).resolves.toBeUndefined();
  });

  it('waits when at or above the threshold', async () => {
    const throttler = new RateThrottler({ threshold: 0.85, bucketResetMs: 10 });
    throttler.update('40/40');
    const started = Date.now();
    await throttler.waitIfNeeded();
    expect(Date.now() - started).toBeGreaterThanOrEqual(10);
  });
});

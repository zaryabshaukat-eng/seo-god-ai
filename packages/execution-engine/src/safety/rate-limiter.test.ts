import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('rate limiter', () => {
  it('canAcquire admits calls within the budget', () => {
    const now = 0;
    const limiter = new RateLimiter({ perMinute: 3, nowMs: () => now });
    expect(limiter.canAcquire('s1')).toBe(true);
    limiter.consume('s1');
    expect(limiter.canAcquire('s1')).toBe(true);
    limiter.consume('s1');
    expect(limiter.canAcquire('s1')).toBe(true);
    limiter.consume('s1');
    expect(limiter.canAcquire('s1')).toBe(false);
    expect(limiter.remaining('s1')).toBe(0);
  });

  it('canAcquire accounts for a requested count', () => {
    const limiter = new RateLimiter({ perMinute: 2, nowMs: () => 0 });
    expect(limiter.canAcquire('s1', 2)).toBe(true);
    expect(limiter.canAcquire('s1', 3)).toBe(false);
  });

  it('waitMs is zero while within budget and positive otherwise', () => {
    let now = 0;
    const limiter = new RateLimiter({ perMinute: 2, nowMs: () => now });
    expect(limiter.waitMs('s1')).toBe(0);
    limiter.consume('s1');
    limiter.consume('s1');
    now = 10;
    expect(limiter.waitMs('s1')).toBe(60_000 - 10);
  });

  it('tokens expire out of the sliding window', () => {
    let now = 0;
    const limiter = new RateLimiter({ perMinute: 1, windowMs: 100, nowMs: () => now });
    limiter.consume('s1');
    expect(limiter.canAcquire('s1')).toBe(false);
    now = 100;
    expect(limiter.canAcquire('s1')).toBe(true);
    limiter.consume('s1');
    expect(limiter.canAcquire('s1')).toBe(false);
  });

  it('waitMs returns 0 once tokens age out', () => {
    let now = 0;
    const limiter = new RateLimiter({ perMinute: 1, windowMs: 100, nowMs: () => now });
    limiter.consume('s1');
    now = 101;
    expect(limiter.waitMs('s1')).toBe(0);
  });

  it('waitMs is zero when the requested count exceeds the window', () => {
    const now = 0;
    const limiter = new RateLimiter({ perMinute: 2, windowMs: 100, nowMs: () => now });
    limiter.consume('s1');
    expect(limiter.waitMs('s1', 5)).toBe(0);
  });

  it('is isolated per store and reset clears all state', () => {
    const now = 0;
    const limiter = new RateLimiter({ perMinute: 1, nowMs: () => now });
    limiter.consume('s1');
    expect(limiter.canAcquire('s2')).toBe(true);
    limiter.reset();
    expect(limiter.canAcquire('s1')).toBe(true);
  });
});

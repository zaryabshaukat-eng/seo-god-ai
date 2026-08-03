import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('is unlimited when maxPerSecond is 0 or missing', async () => {
    const unlimited = new RateLimiter();
    expect(unlimited.isLimited).toBe(false);
    await expect(unlimited.acquire()).resolves.toBeUndefined();
    expect(new RateLimiter({ maxPerSecond: 0 }).isLimited).toBe(false);
  });

  it('enforces minimum spacing between calls', async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = new RateLimiter({
      maxPerSecond: 2,
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    });
    expect(limiter.isLimited).toBe(true);

    await limiter.acquire();
    expect(slept).toEqual([]);

    await limiter.acquire();
    expect(slept).toEqual([500]);

    await limiter.acquire();
    expect(slept).toEqual([500, 500]);
  });

  it('does not sleep when the clock has advanced past the window', async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = new RateLimiter({
      maxPerSecond: 10,
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    });
    await limiter.acquire();
    now += 1000;
    await limiter.acquire();
    expect(slept).toEqual([]);
  });

  it('uses the default sleep when none is provided', async () => {
    const limiter = new RateLimiter({ maxPerSecond: 1000 });
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.isLimited).toBe(true);
  });
});

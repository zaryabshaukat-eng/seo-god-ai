import { describe, expect, it } from 'vitest';
import { buildRetryPolicy } from './retry-policy.js';

describe('retry policy', () => {
  it('uses sensible defaults', () => {
    const policy = buildRetryPolicy();
    expect(policy.maxAttempts).toBe(3);
    expect(policy.baseDelayMs).toBe(250);
    expect(policy.maxDelayMs).toBe(30_000);
    expect(policy.backoffFactor).toBe(2);
    expect(policy.delayFor(1)).toBe(250);
    expect(policy.delayFor(2)).toBe(500);
    expect(policy.delayFor(8)).toBe(30_000);
    expect(policy.isExhausted(3)).toBe(true);
    expect(policy.isExhausted(2)).toBe(false);
  });

  it('honors custom options and clamps low attempts', () => {
    const policy = buildRetryPolicy({ maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 1000, backoffFactor: 3 });
    expect(policy.delayFor(1)).toBe(100);
    expect(policy.delayFor(2)).toBe(300);
    expect(policy.delayFor(3)).toBe(900);
    expect(policy.delayFor(0)).toBe(100);
    expect(policy.isExhausted(5)).toBe(true);
    expect(policy.isExhausted(4)).toBe(false);
  });
});

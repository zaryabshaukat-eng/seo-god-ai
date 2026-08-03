import { describe, expect, it } from 'vitest';
import { clamp, reachFactor, smoothedRate, weightedSum } from './scoring.js';

describe('clamp', () => {
  it('bounds values within the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
  });
});

describe('weightedSum', () => {
  it('combines factors by their weights', () => {
    expect(weightedSum({ a: 2, b: 3 }, { a: 0.5, b: 1 })).toBe(4);
  });

  it('treats missing weights as zero', () => {
    expect(weightedSum({ a: 2, b: 3 }, { a: 0.5 })).toBe(1);
  });
});

describe('reachFactor', () => {
  it('returns zero for non-positive inputs', () => {
    expect(reachFactor(0, 50)).toBe(0);
    expect(reachFactor(5, 0)).toBe(0);
    expect(reachFactor(-2, 50)).toBe(0);
  });

  it('grows with the count but flattens', () => {
    const small = reachFactor(5, 50);
    const large = reachFactor(50, 50);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThan(1);
  });
});

describe('smoothedRate', () => {
  it('falls back to the default rate with no attempts', () => {
    expect(smoothedRate(0, 0, 0.5)).toBe(0.5);
  });

  it('pulls small samples toward the default', () => {
    const oneSuccess = smoothedRate(1, 1, 0.5);
    expect(oneSuccess).toBeGreaterThan(0.5);
    expect(oneSuccess).toBeLessThan(1);
    expect(smoothedRate(100, 100, 0.5)).toBeCloseTo(101 / 102, 5);
  });
});

import { describe, expect, it } from 'vitest';
import {
  average,
  clamp,
  firstDefinedStoreId,
  latestCreatedAt,
  newLearningId,
  reachFactor,
  smoothedRate,
} from './utils.js';

describe('clamp', () => {
  it('keeps in-range values', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
  it('clamps below the minimum', () => {
    expect(clamp(-2, 0, 1)).toBe(0);
  });
  it('clamps above the maximum', () => {
    expect(clamp(3, 0, 1)).toBe(1);
  });
});

describe('average', () => {
  it('returns 0 for an empty array', () => {
    expect(average([])).toBe(0);
  });
  it('averages values', () => {
    expect(average([1, 2, 3])).toBe(2);
  });
});

describe('reachFactor', () => {
  it('returns 0 when count or reference is not positive', () => {
    expect(reachFactor(0, 10)).toBe(0);
    expect(reachFactor(5, 0)).toBe(0);
  });
  it('flattens as counts grow', () => {
    expect(reachFactor(5, 5)).toBeCloseTo(0.5);
    expect(reachFactor(15, 5)).toBeCloseTo(0.75);
  });
});

describe('smoothedRate', () => {
  it('returns the default when there are no attempts', () => {
    expect(smoothedRate(0, 0, 0.5)).toBe(0.5);
  });
  it('pulls small samples toward the default', () => {
    const rate = smoothedRate(1, 1, 0.5);
    expect(rate).toBeGreaterThan(0.5);
    expect(rate).toBeLessThan(1);
  });
});

describe('newLearningId', () => {
  it('builds a prefixed, unique id', () => {
    const a = newLearningId('seed');
    const b = newLearningId('seed');
    expect(a).toMatch(/^lrn_seed_/);
    expect(a).not.toBe(b);
  });
});

describe('latestCreatedAt', () => {
  it('returns undefined for empty input', () => {
    expect(latestCreatedAt([])).toBeUndefined();
  });
  it('returns the newest timestamp', () => {
    const records = [
      { createdAt: '2024-01-01T00:00:00.000Z' },
      { createdAt: '2024-02-01T00:00:00.000Z' },
    ];
    expect(latestCreatedAt(records)).toBe('2024-02-01T00:00:00.000Z');
  });
  it('ignores records that are not newer', () => {
    const records = [
      { createdAt: '2024-02-01T00:00:00.000Z' },
      { createdAt: '2024-01-01T00:00:00.000Z' },
    ];
    expect(latestCreatedAt(records)).toBe('2024-02-01T00:00:00.000Z');
  });
});

describe('firstDefinedStoreId', () => {
  it('returns undefined when none are defined', () => {
    expect(firstDefinedStoreId([{}, {}])).toBeUndefined();
  });
  it('returns the first defined store id', () => {
    expect(firstDefinedStoreId([{ storeId: 's1' }, { storeId: 's2' }])).toBe('s1');
  });
  it('skips undefined entries', () => {
    expect(firstDefinedStoreId([{}, { storeId: 's2' }])).toBe('s2');
  });
});

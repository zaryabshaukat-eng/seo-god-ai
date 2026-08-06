import { describe, expect, it } from 'vitest';
import {
  addDays,
  clamp,
  datePart,
  daysBetween,
  daysIn,
  fillDateRange,
  inPeriod,
  isIsoDate,
  newReportId,
  percentChange,
  percentile,
  periodFor,
  previousPeriod,
  round,
  safeDivide,
  toFinite,
  toIsoDate,
} from './utils.js';

describe('clamp', () => {
  it('clamps above the max and below the min', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(-3, 0, 10)).toBe(0);
  });
});

describe('round', () => {
  it('rounds to a fixed number of decimals', () => {
    expect(round(3.14159)).toBe(3.14);
    expect(round(3.14159, 4)).toBe(3.1416);
    expect(round(2.5)).toBe(2.5);
  });
});

describe('safeDivide', () => {
  it('returns a ratio or null for zero denominators', () => {
    expect(safeDivide(10, 4)).toBe(2.5);
    expect(safeDivide(10, 0)).toBeNull();
  });
});

describe('percentChange', () => {
  it('computes percentage change', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(80, 100)).toBe(-20);
  });
  it('returns null when not computable', () => {
    expect(percentChange(null, 100)).toBeNull();
    expect(percentChange(5, null)).toBeNull();
    expect(percentChange(5, 0)).toBeNull();
  });
});

describe('toIsoDate', () => {
  it('formats a local date', () => {
    expect(toIsoDate(new Date(2024, 0, 5))).toBe('2024-01-05');
    expect(toIsoDate(new Date(2024, 11, 31))).toBe('2024-12-31');
  });
});

describe('addDays', () => {
  it('adds days across month boundaries', () => {
    expect(addDays('2024-01-31', 1)).toBe('2024-02-01');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2024-01-10', -2)).toBe('2024-01-08');
    expect(addDays('2024', 1)).toBe('2024-01-02');
  });
});

describe('daysBetween / daysIn', () => {
  it('counts days between inclusive dates', () => {
    expect(daysBetween('2024-01-01', '2024-01-10')).toBe(9);
    expect(daysBetween('2024-01-10', '2024-01-01')).toBe(-9);
    expect(daysBetween('2024', '2024-01-02')).toBe(1);
    expect(daysIn({ startDate: '2024-01-01', endDate: '2024-01-10' })).toBe(10);
  });
});

describe('fillDateRange', () => {
  it('lists every date in an inclusive range', () => {
    expect(fillDateRange('2024-01-01', '2024-01-03')).toEqual([
      '2024-01-01',
      '2024-01-02',
      '2024-01-03',
    ]);
    expect(fillDateRange('2024-01-03', '2024-01-03')).toEqual(['2024-01-03']);
    expect(fillDateRange('2024-01-05', '2024-01-01')).toEqual([]);
  });
});

describe('periodFor', () => {
  const now = () => new Date(2024, 0, 10);
  it('honors an explicit range', () => {
    expect(periodFor({ startDate: '2024-01-01', endDate: '2024-01-10' }, now)).toEqual({
      startDate: '2024-01-01',
      endDate: '2024-01-10',
    });
  });
  it('derives a start from days ending today', () => {
    expect(periodFor({ days: 7 }, now)).toEqual({ startDate: '2024-01-04', endDate: '2024-01-10' });
  });
  it('uses the default of 30 days', () => {
    expect(periodFor({}, now)).toEqual({ startDate: '2023-12-12', endDate: '2024-01-10' });
  });
  it('uses the explicit endDate with a startDate', () => {
    expect(periodFor({ startDate: '2024-01-01' }, now)).toEqual({
      startDate: '2024-01-01',
      endDate: '2024-01-10',
    });
  });
});

describe('previousPeriod', () => {
  it('returns the period of the same length before', () => {
    expect(previousPeriod({ startDate: '2024-01-10', endDate: '2024-01-20' })).toEqual({
      startDate: '2023-12-30',
      endDate: '2024-01-09',
    });
  });
});

describe('datePart / inPeriod', () => {
  it('extracts the date part', () => {
    expect(datePart('2024-01-05T10:00:00.000Z')).toBe('2024-01-05');
    expect(datePart('2024-01-05')).toBe('2024-01-05');
    expect(datePart('short')).toBe('short');
  });
  it('checks membership including boundaries', () => {
    const period = { startDate: '2024-01-05', endDate: '2024-01-10' };
    expect(inPeriod('2024-01-05T00:00:00Z', period)).toBe(true);
    expect(inPeriod('2024-01-10T23:59:59Z', period)).toBe(true);
    expect(inPeriod('2024-01-04', period)).toBe(false);
    expect(inPeriod('2024-01-11', period)).toBe(false);
  });
});

describe('percentile', () => {
  it('computes nearest-rank percentiles', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([7], 50)).toBe(7);
  });
});

describe('newReportId', () => {
  it('generates a namespaced id', () => {
    const id = newReportId('rpt');
    expect(id).toMatch(/^rep_rpt_[a-z0-9]+_[a-z0-9]+$/);
    expect(newReportId('rpt')).not.toBe(id);
  });
});

describe('toFinite', () => {
  it('normalizes values to finite numbers or null', () => {
    expect(toFinite(3)).toBe(3);
    expect(toFinite('42')).toBe(42);
    expect(toFinite('abc')).toBeNull();
    expect(toFinite(Number.NaN)).toBeNull();
    expect(toFinite(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFinite(null)).toBeNull();
    expect(toFinite(undefined)).toBeNull();
    expect(toFinite({})).toBeNull();
  });
});

describe('isIsoDate', () => {
  it('validates YYYY-MM-DD strings', () => {
    expect(isIsoDate('2024-01-05')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2024-02-30')).toBe(false);
    expect(isIsoDate('2024-13-01')).toBe(false);
    expect(isIsoDate('2024-00-10')).toBe(false);
    expect(isIsoDate('2024/01/05')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

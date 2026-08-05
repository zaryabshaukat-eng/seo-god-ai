import { describe, expect, it } from 'vitest';
import { HistoricalOutcomeProcessor } from './history.js';
import type { RulePerformance } from './types.js';

const performance = (rule: string, over: Partial<RulePerformance> = {}): RulePerformance => ({
  rule,
  attempts: 1,
  successes: 1,
  failures: 0,
  skipped: 0,
  rolledBack: 0,
  successRate: 1,
  rollbackRate: 0,
  averageImpact: 10,
  averageDurationMs: 0,
  ...over,
});

describe('HistoricalOutcomeProcessor', () => {
  it('projects performances to historical outcomes sorted by rule', () => {
    const result = new HistoricalOutcomeProcessor([
      performance('zeta'),
      performance('alpha', { attempts: 3, successes: 2, averageImpact: 5 }),
    ]).process();
    expect(result).toEqual([
      { rule: 'alpha', attempts: 3, successes: 2, averageImpact: 5 },
      { rule: 'zeta', attempts: 1, successes: 1, averageImpact: 10 },
    ]);
  });

  it('merges with existing outcomes using a weighted average impact', () => {
    const processor = new HistoricalOutcomeProcessor([
      performance('r1', { attempts: 2, successes: 2, averageImpact: 50 }),
    ]);
    const result = processor.process({
      existing: [{ rule: 'r1', attempts: 1, successes: 0, averageImpact: 0 }],
    });
    expect(result).toEqual([{ rule: 'r1', attempts: 3, successes: 2, averageImpact: (50 * 2) / 3 }]);
  });

  it('handles zero attempts across the merge', () => {
    const processor = new HistoricalOutcomeProcessor([
      performance('r1', { attempts: 0, successes: 0, averageImpact: 0 }),
    ]);
    const result = processor.process({
      existing: [{ rule: 'r1', attempts: 0, successes: 0, averageImpact: 10 }],
    });
    expect(result[0]?.averageImpact).toBe(0);
    expect(result[0]?.attempts).toBe(0);
  });

  it('returns empty when there is no data', () => {
    expect(new HistoricalOutcomeProcessor([]).process()).toEqual([]);
  });
});

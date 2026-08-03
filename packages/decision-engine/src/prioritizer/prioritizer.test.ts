import { describe, expect, it } from 'vitest';
import { decisionInput, recommendation } from '../test/fixtures.js';
import {
  comparePrioritized,
  decisionContextFromInput,
  Prioritizer,
} from './prioritizer.js';
import type { PrioritizedRecommendation } from '../types/prioritizer.js';

function entry(
  rec: ReturnType<typeof recommendation>,
  score: number,
  rank = 1,
): PrioritizedRecommendation {
  return { recommendation: rec, score, rank, breakdown: {
    impact: 1,
    businessValue: 0.65,
    confidence: 0.85,
    reach: 0.1,
    effort: 1,
    historicalEffectiveness: 0.5,
  } };
}

describe('decisionContextFromInput', () => {
  it('applies defaults for optional fields', () => {
    const input = decisionInput({ historicalOutcomes: undefined, graph: undefined, requestedBy: undefined });
    const context = decisionContextFromInput(input);
    expect(context.historicalOutcomes).toEqual([]);
    expect(context.graph).toBeNull();
    expect(context.requestedBy).toBe('system');
  });

  it('preserves provided fields', () => {
    const context = decisionContextFromInput(decisionInput());
    expect(context.requestedBy).toBe('test-user');
    expect(context.featureFlags).toEqual({});
  });
});

describe('comparePrioritized', () => {
  it('orders by score descending first', () => {
    const a = entry(recommendation({ id: 'a' }), 90);
    const b = entry(recommendation({ id: 'b' }), 80);
    expect(comparePrioritized(a, b)).toBeLessThan(0);
    expect(comparePrioritized(b, a)).toBeGreaterThan(0);
  });

  it('breaks score ties by priority', () => {
    const high = entry(recommendation({ id: 'a', priority: 'HIGH' }), 80);
    const low = entry(recommendation({ id: 'b', priority: 'LOW' }), 80);
    expect(comparePrioritized(high, low)).toBeLessThan(0);
  });

  it('breaks score and priority ties by rule then id', () => {
    const x = entry(recommendation({ id: 'z', rule: 'a-rule' }), 80);
    const y = entry(recommendation({ id: 'a', rule: 'z-rule' }), 80);
    expect(comparePrioritized(x, y)).toBeLessThan(0);
    const p = entry(recommendation({ id: 'p' }), 80);
    const q = entry(recommendation({ id: 'q' }), 80);
    expect(comparePrioritized(p, q)).toBeLessThan(0);
  });
});

describe('Prioritizer', () => {
  it('assigns stable 1-based ranks by descending score', () => {
    const prioritizer = new Prioritizer();
    const input = decisionInput({
      recommendations: [
        recommendation({ id: 'rec-high', confidence: 1, impact: 'HIGH', effort: 'LOW' }),
        recommendation({ id: 'rec-low', confidence: 0.1, impact: 'LOW', effort: 'HIGH' }),
      ],
    });
    const prioritized = prioritizer.prioritize(input);
    expect(prioritized).toHaveLength(2);
    expect(prioritized.map((entry) => entry.rank)).toEqual([1, 2]);
    expect(prioritized[0]!.recommendation.id).toBe('rec-high');
    expect(prioritized[1]!.recommendation.id).toBe('rec-low');
    expect(prioritized[0]!.score).toBeGreaterThan(prioritized[1]!.score);
  });

  it('is deterministic across runs', () => {
    const prioritizer = new Prioritizer();
    const input = decisionInput({
      recommendations: [
        recommendation({ id: 'rec-a', confidence: 0.9 }),
        recommendation({ id: 'rec-b', confidence: 0.7 }),
      ],
    });
    expect(prioritizer.prioritize(input).map((entry) => entry.rank)).toEqual(
      prioritizer.prioritize(input).map((entry) => entry.rank),
    );
  });

  it('honors custom weights', () => {
    const prioritizer = new Prioritizer({ weights: { impact: 1 } });
    const input = decisionInput({
      recommendations: [
        recommendation({ id: 'rec-m', impact: 'MEDIUM' }),
        recommendation({ id: 'rec-l', impact: 'LOW' }),
      ],
    });
    const prioritized = prioritizer.prioritize(input);
    expect(prioritized[0]!.recommendation.id).toBe('rec-m');
  });
});

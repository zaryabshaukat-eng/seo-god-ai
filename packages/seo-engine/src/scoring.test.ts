import { describe, expect, it } from 'vitest';
import {
  EFFORT_ORDER,
  EFFORT_SCORE,
  IMPACT_ORDER,
  IMPACT_SCORE,
  PRIORITY_ORDER,
  bumpImpact,
  clamp,
  compareRecommendations,
  computeConfidence,
  computeScore,
  priorityFromScore,
} from './scoring.js';
import { DEFAULT_SCORING } from './config.js';
import type { Recommendation } from './types.js';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'id',
    rule: 'missing-title',
    category: 'content',
    priority: 'MEDIUM',
    score: 50,
    impact: 'MEDIUM',
    effort: 'MEDIUM',
    confidence: 0.7,
    title: 't',
    description: 'd',
    rationale: 'r',
    recommendedAction: 'a',
    evidence: [],
    affectedUrls: ['https://a.com'],
    pageCount: 1,
    occurrenceCount: 1,
    crawlJobId: 'job',
    storeId: 'store',
    aiContext: {
      rule: 'missing-title',
      category: 'content',
      priority: 'MEDIUM',
      score: 50,
      impact: 'MEDIUM',
      effort: 'MEDIUM',
      summary: 's',
      recommendedAction: 'a',
      affectedUrls: [],
      evidenceValues: [],
      constraints: [],
    },
    ...overrides,
  };
}

describe('scoring', () => {
  it('maps impact levels to scores', () => {
    expect(IMPACT_SCORE).toEqual({ HIGH: 100, MEDIUM: 60, LOW: 30 });
    expect(EFFORT_SCORE).toEqual({ HIGH: 30, MEDIUM: 60, LOW: 100 });
    expect(IMPACT_ORDER).toEqual({ HIGH: 2, MEDIUM: 1, LOW: 0 });
    expect(EFFORT_ORDER).toEqual({ LOW: 0, MEDIUM: 1, HIGH: 2 });
    expect(PRIORITY_ORDER).toEqual({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 });
  });

  it('computes the weighted composite score', () => {
    expect(computeScore('HIGH', 1, 'LOW', DEFAULT_SCORING)).toBe(100);
    expect(computeScore('LOW', 0, 'HIGH', DEFAULT_SCORING)).toBe(21);
    expect(computeScore('MEDIUM', 0.5, 'MEDIUM', DEFAULT_SCORING)).toBe(57);
  });

  it('respects custom scoring weights', () => {
    const score = computeScore('HIGH', 1, 'LOW', {
      impactWeight: 1,
      confidenceWeight: 0,
      effortWeight: 0,
    });
    expect(score).toBe(100);
  });

  it('clamps the score to 0..100', () => {
    expect(computeScore('HIGH', 1, 'LOW', { impactWeight: 10, confidenceWeight: 0, effortWeight: 0 })).toBe(100);
    expect(computeScore('LOW', 0, 'HIGH', { impactWeight: 0, confidenceWeight: 0, effortWeight: 0 })).toBe(0);
  });

  it('maps scores to priorities', () => {
    expect(priorityFromScore(80)).toBe('CRITICAL');
    expect(priorityFromScore(60)).toBe('HIGH');
    expect(priorityFromScore(40)).toBe('MEDIUM');
    expect(priorityFromScore(10)).toBe('LOW');
    expect(priorityFromScore(100)).toBe('CRITICAL');
    expect(priorityFromScore(0)).toBe('LOW');
  });

  it('bumps LOW and MEDIUM impact up to HIGH and leaves HIGH alone', () => {
    expect(bumpImpact('LOW')).toBe('MEDIUM');
    expect(bumpImpact('MEDIUM')).toBe('HIGH');
    expect(bumpImpact('HIGH')).toBe('HIGH');
  });

  it('computes confidence deterministically', () => {
    expect(computeConfidence(true, 1, true)).toBe(0.85);
    expect(computeConfidence(true, 1, false)).toBe(0.7);
    expect(computeConfidence(false, 1, true)).toBe(0.7);
    expect(computeConfidence(false, 1, false)).toBeCloseTo(0.55);
  });

  it('boosts confidence past three pages and respects the range', () => {
    expect(computeConfidence(true, 3, true)).toBe(0.95);
    expect(computeConfidence(false, 10, false)).toBeCloseTo(0.65);
    expect(computeConfidence(true, 3, false)).toBeCloseTo(0.8);
  });

  it('clamps numbers to a range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('sorts by priority, then score, then rule, then first URL', () => {
    const high = rec({ priority: 'HIGH', score: 80, rule: 'z-rule', affectedUrls: ['https://b.com'] });
    const low = rec({ priority: 'LOW', score: 20, affectedUrls: ['https://a.com'] });
    const med = rec({ priority: 'MEDIUM', score: 60, affectedUrls: ['https://a.com'] });
    const medSameRuleA = rec({ priority: 'MEDIUM', score: 60, rule: 'a-rule', affectedUrls: ['https://a.com'] });
    const medSameRuleB = rec({ priority: 'MEDIUM', score: 60, rule: 'a-rule', affectedUrls: ['https://b.com'] });
    expect([low, med, high].sort(compareRecommendations).map((r) => r.priority)).toEqual([
      'HIGH',
      'MEDIUM',
      'LOW',
    ]);
    expect([medSameRuleB, med, medSameRuleA].sort(compareRecommendations).map((r) => r.rule)).toEqual([
      'a-rule',
      'a-rule',
      'missing-title',
    ]);
  });

  it('breaks ties on the first URL, defaulting empty lists to empty string', () => {
    const empty = rec({ affectedUrls: [] });
    const a = rec({ affectedUrls: ['https://a.com'] });
    expect(compareRecommendations(empty, a)).toBeLessThan(0);
    expect(compareRecommendations(a, empty)).toBeGreaterThan(0);
    expect(compareRecommendations(empty, rec({ affectedUrls: [] }))).toBe(0);
  });
});

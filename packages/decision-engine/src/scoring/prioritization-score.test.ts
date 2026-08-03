import { describe, expect, it } from 'vitest';
import { decisionInput, graphContext, ORIGIN, recommendation } from '../test/fixtures.js';
import { decisionContextFromInput } from '../prioritizer/prioritizer.js';
import {
  businessValueFactor,
  DEFAULT_PRIORITIZER_WEIGHTS,
  easeFactor,
  historicalEffectivenessFactor,
  impactFactor,
  reachFactorFor,
  scoreRecommendation,
} from './prioritization-score.js';

function context() {
  return decisionContextFromInput(decisionInput());
}

describe('impactFactor', () => {
  it('normalizes impact levels to 0..1', () => {
    expect(impactFactor(recommendation({ impact: 'HIGH' }))).toBe(1);
    expect(impactFactor(recommendation({ impact: 'MEDIUM' }))).toBe(0.6);
    expect(impactFactor(recommendation({ impact: 'LOW' }))).toBe(0.3);
  });
});

describe('easeFactor', () => {
  it('expresses effort as ease', () => {
    expect(easeFactor(recommendation({ effort: 'LOW' }))).toBe(1);
    expect(easeFactor(recommendation({ effort: 'MEDIUM' }))).toBe(0.6);
    expect(easeFactor(recommendation({ effort: 'HIGH' }))).toBe(0.3);
  });
});

describe('reachFactorFor', () => {
  it('scales with page count against the reference', () => {
    expect(reachFactorFor(recommendation({ pageCount: 50 }), 50)).toBe(0.5);
    expect(reachFactorFor(recommendation({ pageCount: 0 }), 50)).toBe(0);
  });
});

describe('businessValueFactor', () => {
  it('uses the category baseline when there is no context', () => {
    expect(businessValueFactor(recommendation({ category: 'content' }), context())).toBe(0.65);
  });

  it('boosts when affected URLs are orphaned', () => {
    const ctx = decisionContextFromInput(
      decisionInput({ graph: graphContext({ orphanPages: [{ id: 'o', url: `${ORIGIN}/p/1`, type: 'page', inLinks: 0 }] }) }),
    );
    expect(businessValueFactor(recommendation(), ctx)).toBe(0.95);
  });

  it('boosts money-page URLs', () => {
    const rec = recommendation({ affectedUrls: [`${ORIGIN}/products/1`, `${ORIGIN}/other`] });
    expect(businessValueFactor(rec, context())).toBeCloseTo(0.75, 5);
  });

  it('clamps at 1', () => {
    const ctx = decisionContextFromInput(
      decisionInput({ graph: graphContext({ orphanPages: [{ id: 'o', url: `${ORIGIN}/products/1`, type: 'page', inLinks: 0 }] }) }),
    );
    const rec = recommendation({ affectedUrls: [`${ORIGIN}/products/1`] });
    expect(businessValueFactor(rec, ctx)).toBe(1);
  });

  it('keeps the baseline for recommendations without urls', () => {
    expect(businessValueFactor(recommendation({ affectedUrls: [] }), context())).toBe(0.65);
  });
});

describe('historicalEffectivenessFactor', () => {
  it('defaults to 0.5 without prior outcomes', () => {
    expect(historicalEffectivenessFactor(recommendation(), context())).toBe(0.5);
  });

  it('smoothes observed outcomes', () => {
    const ctx = decisionContextFromInput(
      decisionInput({ historicalOutcomes: [{ rule: 'missing-title', attempts: 10, successes: 10, averageImpact: 90 }] }),
    );
    expect(historicalEffectivenessFactor(recommendation(), ctx)).toBeCloseTo(11 / 12, 5);
  });
});

describe('scoreRecommendation', () => {
  it('produces a deterministic 0..100 score with a breakdown', () => {
    const { score, breakdown } = scoreRecommendation(recommendation(), context());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(breakdown).toMatchObject({
      impact: 1,
      businessValue: 0.65,
      confidence: 0.85,
      effort: 1,
      historicalEffectiveness: 0.5,
    });
  });

  it('reaches the max score under maximal factors', () => {
    const weights = DEFAULT_PRIORITIZER_WEIGHTS;
    const ctx = decisionContextFromInput(
      decisionInput({
        graph: graphContext({
          orphanPages: [{ id: 'o', url: `${ORIGIN}/products/1`, type: 'page', inLinks: 0 }],
        }),
        historicalOutcomes: [
          { rule: 'missing-title', attempts: 100000, successes: 100000, averageImpact: 90 },
        ],
      }),
    );
    const rec = recommendation({
      impact: 'HIGH',
      effort: 'LOW',
      confidence: 1,
      pageCount: 1000000,
      affectedUrls: [`${ORIGIN}/products/1`],
    });
    const { score } = scoreRecommendation(rec, ctx, weights, 50);
    expect(score).toBe(100);
  });
});

import { EFFORT_SCORE, IMPACT_SCORE } from '@seogod/seo-engine';
import type { Recommendation } from '@seogod/seo-engine';
import type { DecisionContext } from '../types/input.js';
import type { ScoreBreakdown } from '../types/prioritizer.js';
import { clamp, reachFactor, smoothedRate } from '../utils/scoring.js';

/**
 * Deterministic priority scoring. Every factor is normalized to 0..1 where
 * higher is better (effort is expressed as *ease*), then combined with the
 * configurable weights into a 0..100 score.
 */
export interface PrioritizerWeights {
  impact: number;
  businessValue: number;
  confidence: number;
  reach: number;
  effort: number;
  historicalEffectiveness: number;
}

export const DEFAULT_PRIORITIZER_WEIGHTS: PrioritizerWeights = {
  impact: 0.3,
  businessValue: 0.2,
  confidence: 0.15,
  reach: 0.15,
  effort: 0.1,
  historicalEffectiveness: 0.1,
};

/** Baseline business value by recommendation category. */
const CATEGORY_VALUE: Record<Recommendation['category'], number> = {
  content: 0.65,
  links: 0.7,
  performance: 0.55,
  'structured-data': 0.5,
  indexing: 0.7,
  internationalization: 0.4,
  technical: 0.5,
};

export function impactFactor(recommendation: Recommendation): number {
  return IMPACT_SCORE[recommendation.impact] / 100;
}

/** Effort expressed as ease: LOW effort scores 1, HIGH effort scores 0.3. */
export function easeFactor(recommendation: Recommendation): number {
  return EFFORT_SCORE[recommendation.effort] / 100;
}

export function reachFactorFor(recommendation: Recommendation, maxReachPages: number): number {
  return reachFactor(recommendation.pageCount, maxReachPages);
}

/**
 * Business value = category baseline, boosted when the recommendation fixes
 * orphaned pages or touches money pages (product/collection URLs).
 */
export function businessValueFactor(
  recommendation: Recommendation,
  context: DecisionContext,
): number {
  const urls = recommendation.affectedUrls;
  const base = CATEGORY_VALUE[recommendation.category];
  if (urls.length === 0) return base;

  let boost = 0;
  if (context.graph !== null) {
    const orphanUrls = new Set(context.graph.orphanPages.map((page) => page.url));
    const orphanHits = urls.filter((url) => orphanUrls.has(url)).length;
    boost += 0.3 * (orphanHits / urls.length);
  }
  const moneyHits = urls.filter((url) => /\/products\/|\/collections\//.test(url)).length;
  boost += 0.2 * (moneyHits / urls.length);
  return clamp(base + boost, 0, 1);
}

/** Bayesian-smoothed historical effectiveness for the recommendation's rule. */
export function historicalEffectivenessFactor(
  recommendation: Recommendation,
  context: DecisionContext,
): number {
  const outcome = context.historicalOutcomes.find((entry) => entry.rule === recommendation.rule);
  if (outcome === undefined) return 0.5;
  return smoothedRate(outcome.attempts, outcome.successes, 0.5);
}

export interface ScoredRecommendation {
  score: number;
  breakdown: ScoreBreakdown;
}

export function scoreRecommendation(
  recommendation: Recommendation,
  context: DecisionContext,
  weights: PrioritizerWeights = DEFAULT_PRIORITIZER_WEIGHTS,
  maxReachPages = 50,
): ScoredRecommendation {
  const breakdown: ScoreBreakdown = {
    impact: impactFactor(recommendation),
    businessValue: businessValueFactor(recommendation, context),
    confidence: recommendation.confidence,
    reach: reachFactor(recommendation.pageCount, maxReachPages),
    effort: easeFactor(recommendation),
    historicalEffectiveness: historicalEffectivenessFactor(recommendation, context),
  };
  const raw =
    weights.impact * breakdown.impact +
    weights.businessValue * breakdown.businessValue +
    weights.confidence * breakdown.confidence +
    weights.reach * breakdown.reach +
    weights.effort * breakdown.effort +
    weights.historicalEffectiveness * breakdown.historicalEffectiveness;
  return { score: Math.round(clamp(raw * 100, 0, 100)), breakdown };
}

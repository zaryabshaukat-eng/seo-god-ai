/**
 * Prioritizer output types. A {@link PrioritizedRecommendation} is a source
 * recommendation plus a deterministic 0..100 priority score and its factor
 * breakdown, so the reasoning behind an ordering is always explainable.
 */

import type { Recommendation } from '@seogod/seo-engine';

export interface ScoreBreakdown {
  impact: number;
  businessValue: number;
  confidence: number;
  reach: number;
  effort: number;
  historicalEffectiveness: number;
}

export interface PrioritizedRecommendation {
  recommendation: Recommendation;
  /** 0..100 composite priority. */
  score: number;
  /** 1-based rank after stable sorting (ties broken deterministically). */
  rank: number;
  breakdown: ScoreBreakdown;
}

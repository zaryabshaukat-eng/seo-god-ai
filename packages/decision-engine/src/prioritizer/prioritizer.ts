import { PRIORITY_ORDER } from '@seogod/seo-engine';
import type { DecisionContext, DecisionEngineInput } from '../types/input.js';
import type { PrioritizedRecommendation } from '../types/prioritizer.js';
import {
  DEFAULT_PRIORITIZER_WEIGHTS,
  scoreRecommendation,
  type PrioritizerWeights,
} from '../scoring/prioritization-score.js';

export interface PrioritizerOptions {
  weights?: Partial<PrioritizerWeights>;
  /** Reference page count for the reach factor (higher flattens the curve). */
  maxReachPages?: number;
}

/** Builds the persisted decision context from a top-level input. */
export function decisionContextFromInput(input: DecisionEngineInput): DecisionContext {
  return {
    storeSettings: input.storeSettings,
    featureFlags: input.featureFlags,
    historicalOutcomes: input.historicalOutcomes ?? [],
    graph: input.graph ?? null,
    requestedBy: input.requestedBy ?? 'system',
  };
}

/** Stable comparator: score desc, priority asc, then rule, then id. */
export function comparePrioritized(a: PrioritizedRecommendation, b: PrioritizedRecommendation): number {
  if (a.score !== b.score) return b.score - a.score;
  const byPriority = PRIORITY_ORDER[a.recommendation.priority] - PRIORITY_ORDER[b.recommendation.priority];
  if (byPriority !== 0) return byPriority;
  const byRule = a.recommendation.rule.localeCompare(b.recommendation.rule);
  if (byRule !== 0) return byRule;
  return a.recommendation.id.localeCompare(b.recommendation.id);
}

/**
 * Sorts recommendations by their composite priority score. Fully
 * deterministic: identical input always yields identical order and ranks.
 */
export class Prioritizer {
  private readonly weights: PrioritizerWeights;
  private readonly maxReachPages: number;

  constructor(options: PrioritizerOptions = {}) {
    this.weights = { ...DEFAULT_PRIORITIZER_WEIGHTS, ...options.weights };
    this.maxReachPages = options.maxReachPages ?? 50;
  }

  prioritize(input: DecisionEngineInput): PrioritizedRecommendation[] {
    const context = decisionContextFromInput(input);
    const scored: PrioritizedRecommendation[] = input.recommendations.map((recommendation) => {
      const { score, breakdown } = scoreRecommendation(
        recommendation,
        context,
        this.weights,
        this.maxReachPages,
      );
      return { recommendation, score, breakdown, rank: 0 };
    });
    scored.sort(comparePrioritized);
    return scored.map((entry, index) => ({ ...entry, rank: index + 1 }));
  }
}

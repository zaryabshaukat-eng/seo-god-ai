/**
 * Learned recommendation scoring. Scores a recommendation 0..100 by combining
 * calibrated confidence, historical effectiveness (bayesian-smoothed success
 * rate), feedback sentiment, impact, reach and effort. This is the learning
 * engine's counterpart to the decision engine's static prioritization score.
 */

import { ConfidenceCalibrator } from './calibration.js';
import { ScoreValidationError } from './errors.js';
import type { LearningStore } from './store.js';
import type {
  RecommendationScoreInput,
  RecommendationScoreResult,
  RulePerformance,
  ScoreBreakdown,
} from './types.js';
import { clamp, latestCreatedAt, reachFactor, smoothedRate } from './utils.js';

export interface ScorerWeights {
  impact: number;
  calibratedConfidence: number;
  historicalEffectiveness: number;
  reach: number;
  effort: number;
  feedback: number;
}

export const DEFAULT_SCORER_WEIGHTS: ScorerWeights = {
  impact: 0.3,
  calibratedConfidence: 0.2,
  historicalEffectiveness: 0.2,
  reach: 0.1,
  effort: 0.1,
  feedback: 0.1,
};

export class RecommendationScorer {
  constructor(
    private readonly store: LearningStore,
    private readonly calibrator: ConfidenceCalibrator = new ConfidenceCalibrator(store),
  ) {}

  async score(
    input: RecommendationScoreInput,
    weights: ScorerWeights = DEFAULT_SCORER_WEIGHTS,
  ): Promise<RecommendationScoreResult> {
    if (
      !Number.isFinite(input.confidence) ||
      !Number.isFinite(input.impact) ||
      !Number.isFinite(input.effort)
    ) {
      throw new ScoreValidationError('confidence, impact and effort must be finite numbers', {
        rule: input.rule,
      });
    }
    const impact = clamp(input.impact, 0, 1);
    const effort = clamp(input.effort, 0, 1);

    const [calibration, performance, feedbackScore] = await Promise.all([
      this.calibrator.calibrate(input.rule, input.confidence),
      this.rulePerformance(input.rule),
      this.feedbackScore(input.rule),
    ]);

    const historicalEffectiveness =
      performance === null ? 0.5 : smoothedRate(performance.attempts, performance.successes, 0.5);
    const reach = reachFactor(input.pageCount ?? 1, input.maxReachPages ?? 50);

    const breakdown: ScoreBreakdown = {
      impact,
      calibratedConfidence: calibration.calibratedConfidence,
      historicalEffectiveness,
      reach,
      effort,
      feedback: feedbackScore,
    };

    const raw =
      weights.impact * impact +
      weights.calibratedConfidence * calibration.calibratedConfidence +
      weights.historicalEffectiveness * historicalEffectiveness +
      weights.reach * reach +
      weights.effort * effort +
      weights.feedback * feedbackScore;

    return {
      rule: input.rule,
      score: Math.round(clamp(raw * 100, 0, 100)),
      breakdown,
    };
  }

  private async rulePerformance(rule: string): Promise<RulePerformance | null> {
    const outcomes = await this.store.listOutcomes({ rule });
    if (outcomes.length === 0) return null;
    const successes = outcomes.filter((outcome) => outcome.status === 'SUCCESS').length;
    const failures = outcomes.filter((outcome) => outcome.status === 'FAILURE').length;
    const skipped = outcomes.filter((outcome) => outcome.status === 'SKIPPED').length;
    const rolledBack = outcomes.filter((outcome) => outcome.status === 'ROLLED_BACK').length;
    const attempts = outcomes.length;
    const impacts = outcomes
      .map((outcome) => outcome.impact)
      .filter((impact): impact is number => impact !== undefined);
    const durations = outcomes
      .map((outcome) => outcome.durationMs)
      .filter((duration): duration is number => duration !== undefined);
    return {
      rule,
      attempts,
      successes,
      failures,
      skipped,
      rolledBack,
      successRate: successes / attempts,
      rollbackRate: rolledBack / attempts,
      averageImpact: impacts.length === 0 ? 0 : impacts.reduce((sum, value) => sum + value, 0) / impacts.length,
      averageDurationMs: durations.length === 0 ? 0 : durations.reduce((sum, value) => sum + value, 0) / durations.length,
      lastExecutedAt: latestCreatedAt(outcomes),
    };
  }

  private async feedbackScore(rule: string): Promise<number> {
    const records = await this.store.listFeedback({ rule });
    if (records.length === 0) return 0.5;
    const positive = records.reduce((count, record) => (record.rating === 1 ? count + 1 : count), 0);
    const negative = records.reduce((count, record) => (record.rating === -1 ? count + 1 : count), 0);
    return clamp(0.5 + 0.5 * ((positive - negative) / records.length), 0, 1);
  }
}

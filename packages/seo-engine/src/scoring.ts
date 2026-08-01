import type { ScoringConfig } from './config.js';
import type { EffortLevel, ImpactLevel, PriorityLevel, Recommendation } from './types.js';

export const IMPACT_SCORE: Record<ImpactLevel, number> = {
  HIGH: 100,
  MEDIUM: 60,
  LOW: 30,
};

export const EFFORT_SCORE: Record<EffortLevel, number> = {
  HIGH: 30,
  MEDIUM: 60,
  LOW: 100,
};

export const PRIORITY_ORDER: Record<PriorityLevel, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export const IMPACT_ORDER: Record<ImpactLevel, number> = {
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
};

export const EFFORT_ORDER: Record<EffortLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

/** Composite 0..100 score: impact, confidence, and effort weighted. */
export function computeScore(
  impact: ImpactLevel,
  confidence: number,
  effort: EffortLevel,
  scoring: ScoringConfig,
): number {
  const raw =
    scoring.impactWeight * IMPACT_SCORE[impact] +
    scoring.confidenceWeight * confidence * 100 +
    scoring.effortWeight * EFFORT_SCORE[effort];
  return clamp(Math.round(raw), 0, 100);
}

/** Maps a score to a deterministic priority bucket. */
export function priorityFromScore(score: number): PriorityLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

/**
 * Raises an impact one level: LOW → MEDIUM → HIGH (stays HIGH). Used for the
 * money-page boost so high-value pages surface first.
 */
export function bumpImpact(impact: ImpactLevel): ImpactLevel {
  if (impact === 'LOW') return 'MEDIUM';
  if (impact === 'MEDIUM') return 'HIGH';
  return 'HIGH';
}

/**
 * Deterministic confidence from evidence quality: objective measurements
 * score higher than heuristics, sample size adds certainty, missing values
 * reduce it. Always within 0.5..0.95.
 */
export function computeConfidence(
  objective: boolean,
  pageCount: number,
  hasValues: boolean,
): number {
  let confidence = objective ? 0.85 : 0.7;
  if (pageCount >= 3) confidence += 0.1;
  if (!hasValues) confidence -= 0.15;
  return clamp(confidence, 0.5, 0.95);
}

/**
 * Deterministic ascending comparator: priority, then score, then rule, then
 * first affected URL. Given identical inputs the output order never changes.
 */
export function compareRecommendations(a: Recommendation, b: Recommendation): number {
  const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (byPriority !== 0) return byPriority;
  const byScore = b.score - a.score;
  if (byScore !== 0) return byScore;
  const byRule = a.rule.localeCompare(b.rule);
  if (byRule !== 0) return byRule;
  return (a.affectedUrls[0] ?? '').localeCompare(b.affectedUrls[0] ?? '');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

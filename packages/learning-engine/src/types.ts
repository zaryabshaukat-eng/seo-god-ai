/**
 * Learning engine domain types. Every input type is structural so callers can
 * hand the engine data straight from the decision engine (`ExecutionResult`),
 * observability (`ExecutionRecord`, `LearningSignal`) or their own stores
 * without requiring those packages as runtime dependencies.
 */

export type FeedbackRating = -1 | 0 | 1;

export type FeedbackSource = 'user' | 'system' | 'automated';

export interface FeedbackInput {
  storeId: string;
  /** Rule id (e.g. `missing-title`) when feedback targets a rule. */
  rule?: string;
  recommendationId?: string;
  executionId?: string;
  rating: FeedbackRating;
  comment?: string;
  source?: FeedbackSource;
  createdAt?: string;
}

export interface FeedbackRecord extends FeedbackInput {
  id: string;
  createdAt: string;
}

export type OutcomeStatus = 'SUCCESS' | 'FAILURE' | 'SKIPPED' | 'ROLLED_BACK';

export interface OutcomeInput {
  executionId: string;
  storeId: string;
  rule?: string;
  status: OutcomeStatus;
  /** Model confidence stated when the action was taken (0..1), used for calibration. */
  confidence?: number;
  /** Measured SEO impact (AFTER minus BEFORE overall score). */
  impact?: number;
  durationMs?: number;
  createdAt?: string;
}

export interface OutcomeRecord extends OutcomeInput {
  id: string;
  createdAt: string;
}

export interface RulePerformance {
  rule: string;
  attempts: number;
  successes: number;
  failures: number;
  skipped: number;
  rolledBack: number;
  /** Fraction of outcomes that succeeded, 0..1. */
  successRate: number;
  /** Fraction of outcomes that were rolled back, 0..1. */
  rollbackRate: number;
  /** Average measured impact across outcomes that report one. */
  averageImpact: number;
  /** Average execution time in ms across outcomes that report one. */
  averageDurationMs: number;
  lastExecutedAt?: string;
}

export interface AnalysisSummary {
  totalOutcomes: number;
  rulesAnalyzed: number;
  overallSuccessRate: number;
  overallAverageImpact: number;
}

export interface OutcomeAnalysis {
  rules: RulePerformance[];
  summary: AnalysisSummary;
}

export interface CalibrationBucket {
  min: number;
  max: number;
  count: number;
  successes: number;
  observedReliability: number;
}

export interface CalibrationReport {
  rule: string;
  inputConfidence: number;
  calibratedConfidence: number;
  /** Number of confidence-labeled outcomes used for calibration. */
  sampleSize: number;
  /** Observed success rate across all labeled outcomes, 0..1. */
  empiricalReliability: number;
  buckets: CalibrationBucket[];
}

export interface RecommendationScoreInput {
  rule: string;
  /** Stated model confidence, 0..1. */
  confidence: number;
  /** Estimated impact factor, 0..1 (higher is better). */
  impact: number;
  /** Effort expressed as ease, 0..1 (higher is easier). */
  effort: number;
  /** Number of affected pages, used for reach. */
  pageCount?: number;
  /** Reference reach count the curve flattens toward. */
  maxReachPages?: number;
}

export interface ScoreBreakdown {
  impact: number;
  calibratedConfidence: number;
  historicalEffectiveness: number;
  reach: number;
  effort: number;
  feedback: number;
}

export interface RecommendationScoreResult {
  rule: string;
  /** Learned 0..100 priority score. */
  score: number;
  breakdown: ScoreBreakdown;
}

export type SignalKind = 'positive' | 'negative' | 'neutral';

export type SignalSource = 'outcome' | 'feedback';

export interface LearnedSignal {
  id: string;
  storeId?: string;
  rule: string;
  kind: SignalKind;
  /** Reward in -1..1 (negative discourages, positive encourages). */
  reward: number;
  /** 0..1 confidence in the signal based on sample size. */
  confidence: number;
  source: SignalSource;
  timestamp: string;
}

export interface SignalGenerationResult {
  signals: LearnedSignal[];
  generatedAt: string;
}

/**
 * Decision-engine compatible historical outcome (`rule`, `attempts`,
 * `successes`, `averageImpact`) ready to be fed into a `DecisionContext`.
 */
export interface HistoricalOutcomeResult {
  rule: string;
  attempts: number;
  successes: number;
  averageImpact: number;
}

export interface LearningFilter {
  storeId?: string;
  rule?: string;
  /** Only entries at or after this ISO timestamp. */
  since?: string;
  /** Cap on returned rows (newest first). */
  limit?: number;
}

/** Structural subset of `@seogod/decision-engine` `ExecutionResult`. */
export interface ExecutionResultLike {
  id: string;
  storeId: string;
  taskId?: string;
  status: 'SUCCESS' | 'FAILURE' | 'SKIPPED';
  durationMs?: number;
  completedAt?: Date;
}

/** Structural subset of `@seogod/observability` `ExecutionRecord`. */
export interface ExecutionRecordLike {
  executionId: string;
  storeId: string;
  operation?: string;
  status: 'QUEUED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'ROLLED_BACK';
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

/** Structural subset of `@seogod/observability` `LearningSignal`. */
export interface LearningSignalLike {
  rule: string;
  attempts: number;
  successes: number;
  averageImpact: number;
}

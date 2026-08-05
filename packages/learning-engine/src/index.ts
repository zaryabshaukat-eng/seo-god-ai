/**
 * @seogod/learning-engine
 *
 * Learning engine for SEO GOD AI: feedback collection, outcome analysis,
 * confidence calibration, learned recommendation scoring, RL-style signals
 * and decision-engine-ready historical outcomes. All integration points
 * (decision engine, observability) are consumed structurally so this package
 * has no runtime dependency on them.
 */

export { OutcomeAnalyzer } from './analysis.js';

export {
  fromExecutionRecord,
  fromExecutionResult,
  fromObservabilitySignal,
} from './adapters.js';

export {
  ConfidenceCalibrator,
} from './calibration.js';
export type { CalibrationOptions } from './calibration.js';

export {
  ConfidenceValidationError,
  FeedbackValidationError,
  LearningConflictError,
  LearningError,
  LearningNotFoundError,
  LearningValidationError,
  OutcomeValidationError,
  ScoreValidationError,
} from './errors.js';
export type { LearningErrorCode, LearningErrorContext } from './errors.js';

export { FeedbackCollector } from './feedback.js';
export type { FeedbackSummary } from './feedback.js';

export { HistoricalOutcomeProcessor } from './history.js';
export type { HistoricalOutcomeMergeOptions } from './history.js';

export { LearningMetrics, LEARNING_METRICS_NAMES } from './metrics.js';

export {
  DEFAULT_SCORER_WEIGHTS,
  RecommendationScorer,
} from './scoring.js';
export type { ScorerWeights } from './scoring.js';

export { LearningEngineService } from './service.js';
export type { LearningEngineServiceOptions } from './service.js';

export { SignalGenerator } from './signals.js';
export type { SignalGeneratorOptions } from './signals.js';

export { InMemoryLearningStore } from './store.js';
export type { LearningStore } from './store.js';

export { average, clamp, newLearningId, reachFactor, smoothedRate } from './utils.js';

export type {
  AnalysisSummary,
  CalibrationBucket,
  CalibrationReport,
  ExecutionRecordLike,
  ExecutionResultLike,
  FeedbackInput,
  FeedbackRating,
  FeedbackRecord,
  FeedbackSource,
  HistoricalOutcomeResult,
  LearnedSignal,
  LearningFilter,
  LearningSignalLike,
  OutcomeAnalysis,
  OutcomeInput,
  OutcomeRecord,
  OutcomeStatus,
  RecommendationScoreInput,
  RecommendationScoreResult,
  RulePerformance,
  ScoreBreakdown,
  SignalGenerationResult,
  SignalKind,
  SignalSource,
} from './types.js';

/**
 * Learning engine facade. Collects feedback, ingests execution outcomes,
 * analyzes per-rule performance, calibrates confidence, scores
 * recommendations, generates RL-style signals and projects decision-engine
 * ready historical outcomes. Optional metrics integration mirrors the rest of
 * the platform.
 */

import type { MetricsRegistry } from '@seogod/monitoring';
import { OutcomeAnalyzer } from './analysis.js';
import { ConfidenceCalibrator, type CalibrationOptions } from './calibration.js';
import { LearningConflictError } from './errors.js';
import { FeedbackCollector } from './feedback.js';
import type { FeedbackSummary } from './feedback.js';
import { HistoricalOutcomeProcessor } from './history.js';
import { LearningMetrics } from './metrics.js';
import { RecommendationScorer } from './scoring.js';
import { SignalGenerator } from './signals.js';
import type { LearningStore } from './store.js';
import type {
  CalibrationReport,
  FeedbackInput,
  FeedbackRecord,
  HistoricalOutcomeResult,
  LearnedSignal,
  LearningFilter,
  OutcomeAnalysis,
  OutcomeInput,
  OutcomeRecord,
  RecommendationScoreInput,
  RecommendationScoreResult,
  SignalGenerationResult,
} from './types.js';
import { newLearningId } from './utils.js';

export interface LearningEngineServiceOptions {
  store: LearningStore;
  now?: () => string;
  metrics?: MetricsRegistry;
}

export class LearningEngineService {
  private readonly store: LearningStore;
  private readonly now: () => string;
  private readonly metrics?: LearningMetrics;
  private readonly feedback: FeedbackCollector;
  private readonly analyzer: OutcomeAnalyzer;
  private readonly calibrator: ConfidenceCalibrator;
  private readonly scorer: RecommendationScorer;
  private readonly signalGenerator: SignalGenerator;

  constructor(options: LearningEngineServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.metrics = options.metrics === undefined ? undefined : new LearningMetrics(options.metrics);
    this.feedback = new FeedbackCollector(this.store);
    this.analyzer = new OutcomeAnalyzer(this.store);
    this.calibrator = new ConfidenceCalibrator(this.store);
    this.scorer = new RecommendationScorer(this.store, this.calibrator);
    this.signalGenerator = new SignalGenerator(this.store);
  }

  // Feedback.

  async recordFeedback(input: FeedbackInput): Promise<FeedbackRecord> {
    const record = await this.feedback.record(input, this.now);
    this.metrics?.feedbackRecorded();
    return record;
  }

  getFeedback(filter: LearningFilter = {}): Promise<FeedbackRecord[]> {
    return this.store.listFeedback(filter);
  }

  summarizeFeedback(filter: LearningFilter = {}): Promise<FeedbackSummary> {
    return this.feedback.summarize(filter);
  }

  // Outcomes and analysis.

  async ingestOutcome(outcome: OutcomeInput): Promise<OutcomeRecord> {
    const existing = await this.store.findOutcome(outcome.executionId);
    if (existing !== null) {
      throw new LearningConflictError(
        `Outcome for execution ${outcome.executionId} already recorded`,
        { executionId: outcome.executionId, rule: outcome.rule, storeId: outcome.storeId },
      );
    }
    const record: OutcomeRecord = {
      ...outcome,
      id: newLearningId(`outcome:${outcome.executionId}`),
      createdAt: outcome.createdAt ?? this.now(),
    };
    await this.store.saveOutcome(record);
    this.metrics?.outcomesIngested();
    return record;
  }

  analyzeOutcomes(filter: LearningFilter = {}): Promise<OutcomeAnalysis> {
    return this.analyzer.analyze(filter);
  }

  // Calibration and scoring.

  calibrate(rule: string, confidence: number, options: CalibrationOptions = {}): Promise<CalibrationReport> {
    return this.calibrator.calibrate(rule, confidence, options);
  }

  scoreRecommendation(input: RecommendationScoreInput): Promise<RecommendationScoreResult> {
    return this.scorer.score(input);
  }

  // Signals.

  async generateSignals(filter: LearningFilter = {}): Promise<SignalGenerationResult> {
    const result = await this.signalGenerator.generate({
      storeId: filter.storeId,
      now: this.now,
    });
    await this.store.saveSignals(result.signals);
    this.metrics?.signalsGenerated(result.signals.length);
    return result;
  }

  getSignals(filter: LearningFilter = {}): Promise<LearnedSignal[]> {
    return this.store.listSignals(filter);
  }

  // Historical outcomes for the decision engine.

  async getHistoricalOutcomes(
    filter: LearningFilter = {},
    existing: HistoricalOutcomeResult[] = [],
  ): Promise<HistoricalOutcomeResult[]> {
    const { rules } = await this.analyzer.analyze(filter);
    return new HistoricalOutcomeProcessor(rules).process({ existing });
  }

  async reset(): Promise<void> {
    await this.store.reset();
  }
}

import type { MetricsRegistry } from '@seogod/monitoring';

export const LEARNING_METRICS_NAMES = {
  feedbackRecorded: 'learning_feedback_recorded',
  outcomesIngested: 'learning_outcomes_ingested',
  signalsGenerated: 'learning_signals_generated',
  calibrations: 'learning_calibrations',
  scoring: 'learning_scoring',
  analyses: 'learning_analyses',
} as const;

/**
 * Thin adapter over the shared {@link MetricsRegistry} exposing the learning
 * engine counters defined in the platform spec. Counters render with a `_total`
 * suffix in Prometheus exposition format.
 */
export class LearningMetrics {
  constructor(private readonly registry: MetricsRegistry) {}

  feedbackRecorded(by = 1): void {
    this.registry.increment(LEARNING_METRICS_NAMES.feedbackRecorded, by);
  }

  outcomesIngested(by = 1): void {
    this.registry.increment(LEARNING_METRICS_NAMES.outcomesIngested, by);
  }

  signalsGenerated(by = 1): void {
    this.registry.increment(LEARNING_METRICS_NAMES.signalsGenerated, by);
  }

  calibrations(by = 1): void {
    this.registry.increment(LEARNING_METRICS_NAMES.calibrations, by);
  }

  scoring(by = 1): void {
    this.registry.increment(LEARNING_METRICS_NAMES.scoring, by);
  }

  analyses(by = 1): void {
    this.registry.increment(LEARNING_METRICS_NAMES.analyses, by);
  }
}

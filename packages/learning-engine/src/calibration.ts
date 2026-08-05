/**
 * Confidence calibration. Uses confidence-labeled outcomes to build a
 * reliability histogram (binned observed success rate) and maps a stated model
 * confidence to a calibrated one, falling back to the empirical overall rate
 * and finally to the raw input when there is no evidence yet.
 */

import { ConfidenceValidationError } from './errors.js';
import type { LearningStore } from './store.js';
import type {
  CalibrationBucket,
  CalibrationReport,
  LearningFilter,
  OutcomeRecord,
} from './types.js';
import { clamp } from './utils.js';

export interface CalibrationOptions {
  storeId?: string;
}

const BUCKETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.25],
  [0.25, 0.5],
  [0.5, 0.75],
  [0.75, 1],
];

export class ConfidenceCalibrator {
  constructor(private readonly store: LearningStore) {}

  async calibrate(rule: string, confidence: number, options: CalibrationOptions = {}): Promise<CalibrationReport> {
    if (!Number.isFinite(confidence)) {
      throw new ConfidenceValidationError('Confidence must be a finite number', { rule });
    }
    const inputConfidence = clamp(confidence, 0, 1);
    const filter: LearningFilter = options.storeId === undefined ? { rule } : { rule, storeId: options.storeId };
    const outcomes = await this.store.listOutcomes(filter);
    const labeled = outcomes.filter(
      (outcome): outcome is OutcomeRecord & { confidence: number } =>
        outcome.confidence !== undefined && Number.isFinite(outcome.confidence),
    );

    const buckets: CalibrationBucket[] = BUCKETS.map(([min, max], index) => {
      const isLast = index === BUCKETS.length - 1;
      const entries = labeled.filter(
        (outcome) => outcome.confidence >= min && (outcome.confidence < max || isLast),
      );
      const successes = entries.reduce(
        (count, outcome) => (outcome.status === 'SUCCESS' ? count + 1 : count),
        0,
      );
      return {
        min,
        max,
        count: entries.length,
        successes,
        observedReliability: entries.length === 0 ? 0 : successes / entries.length,
      };
    });

    const empiricalReliability =
      labeled.length === 0 ? 0 : labeled.reduce((count, outcome) => (outcome.status === 'SUCCESS' ? count + 1 : count), 0) / labeled.length;

    const target = buckets.find((bucket) => inputConfidence >= bucket.min && inputConfidence <= bucket.max);
    let calibratedConfidence: number;
    if (target !== undefined && target.count > 0) {
      calibratedConfidence = target.observedReliability;
    } else if (labeled.length > 0) {
      calibratedConfidence = empiricalReliability;
    } else {
      calibratedConfidence = inputConfidence;
    }

    return {
      rule,
      inputConfidence,
      calibratedConfidence,
      sampleSize: labeled.length,
      empiricalReliability,
      buckets,
    };
  }
}

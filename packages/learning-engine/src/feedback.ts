/**
 * Feedback collection. Validates and records explicit feedback (user,
 * system or automated) against recommendations, executions or rules, and
 * aggregates it into a per-scope summary used by scoring and signals.
 */

import { FeedbackValidationError } from './errors.js';
import type { LearningStore } from './store.js';
import type {
  FeedbackInput,
  FeedbackRecord,
  LearningFilter,
} from './types.js';
import { newLearningId } from './utils.js';

export interface FeedbackSummary {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  /** Net (positive - negative) over total, in -1..1. */
  netScore: number;
}

const RATINGS = new Set<FeedbackInput['rating']>([-1, 0, 1]);

export class FeedbackCollector {
  constructor(private readonly store: LearningStore) {}

  async record(input: FeedbackInput, now: () => string = () => new Date().toISOString()): Promise<FeedbackRecord> {
    if (!RATINGS.has(input.rating)) {
      throw new FeedbackValidationError('rating must be -1, 0 or 1', {
        storeId: input.storeId,
        rule: input.rule,
      });
    }
    if (input.recommendationId === undefined && input.executionId === undefined && input.rule === undefined) {
      throw new FeedbackValidationError('feedback must target a rule, recommendation or execution', {
        storeId: input.storeId,
      });
    }
    const record: FeedbackRecord = {
      ...input,
      id: newLearningId(`feedback:${input.storeId}:${input.executionId ?? ''}:${input.recommendationId ?? ''}`),
      source: input.source ?? 'user',
      createdAt: input.createdAt ?? now(),
    };
    await this.store.saveFeedback(record);
    return record;
  }

  async summarize(filter: LearningFilter = {}): Promise<FeedbackSummary> {
    const records = await this.store.listFeedback(filter);
    const positive = records.reduce((count, record) => (record.rating === 1 ? count + 1 : count), 0);
    const negative = records.reduce((count, record) => (record.rating === -1 ? count + 1 : count), 0);
    const neutral = records.reduce((count, record) => (record.rating === 0 ? count + 1 : count), 0);
    return {
      total: records.length,
      positive,
      neutral,
      negative,
      netScore: records.length === 0 ? 0 : (positive - negative) / records.length,
    };
  }
}

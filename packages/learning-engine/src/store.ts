/**
 * Learning store contract. Keeps feedback, outcomes and generated signals so
 * the engine can accumulate evidence across runs; implementations may be
 * in-memory (tests, single-process) or backed by a database.
 */

import { LearningConflictError } from './errors.js';
import type {
  FeedbackRecord,
  LearnedSignal,
  LearningFilter,
  OutcomeRecord,
} from './types.js';

export interface LearningStore {
  saveFeedback(record: FeedbackRecord): Promise<void>;
  listFeedback(filter?: LearningFilter): Promise<FeedbackRecord[]>;
  saveOutcome(record: OutcomeRecord): Promise<void>;
  listOutcomes(filter?: LearningFilter): Promise<OutcomeRecord[]>;
  findOutcome(executionId: string): Promise<OutcomeRecord | null>;
  saveSignals(signals: LearnedSignal[]): Promise<void>;
  listSignals(filter?: LearningFilter): Promise<LearnedSignal[]>;
  reset(): Promise<void>;
}

type Filterable = {
  storeId?: string;
  rule?: string;
  createdAt?: string;
  timestamp?: string;
};

/** Applies the shared filter, newest first, then caps by limit. */
function applyFilter<T extends Filterable>(
  entries: readonly T[],
  filter: LearningFilter,
  timeOf: (entry: T) => string,
): T[] {
  const filtered: T[] = [];
  for (const entry of entries) {
    if (filter.storeId !== undefined && entry.storeId !== filter.storeId) continue;
    if (filter.rule !== undefined && entry.rule !== filter.rule) continue;
    if (filter.since !== undefined && timeOf(entry) < filter.since) continue;
    filtered.push(entry);
  }
  filtered.sort((a, b) => timeOf(b).localeCompare(timeOf(a)));
  if (filter.limit !== undefined && filtered.length > filter.limit) {
    return filtered.slice(0, filter.limit);
  }
  return filtered;
}

/** Default store shipped for tests and single-process deployments. */
export class InMemoryLearningStore implements LearningStore {
  private feedback: FeedbackRecord[] = [];
  private outcomes: OutcomeRecord[] = [];
  private signals: LearnedSignal[] = [];

  async saveFeedback(record: FeedbackRecord): Promise<void> {
    if (this.feedback.some((entry) => entry.id === record.id)) {
      throw new LearningConflictError(`Feedback ${record.id} already exists`, {
        rule: record.rule,
        storeId: record.storeId,
      });
    }
    this.feedback.push(record);
  }

  async listFeedback(filter: LearningFilter = {}): Promise<FeedbackRecord[]> {
    return applyFilter(this.feedback, filter, (entry) => entry.createdAt);
  }

  async saveOutcome(record: OutcomeRecord): Promise<void> {
    if (this.outcomes.some((entry) => entry.id === record.id)) {
      throw new LearningConflictError(`Outcome ${record.id} already exists`, {
        rule: record.rule,
        storeId: record.storeId,
        executionId: record.executionId,
      });
    }
    this.outcomes.push(record);
  }

  async listOutcomes(filter: LearningFilter = {}): Promise<OutcomeRecord[]> {
    return applyFilter(this.outcomes, filter, (entry) => entry.createdAt);
  }

  async findOutcome(executionId: string): Promise<OutcomeRecord | null> {
    return this.outcomes.find((entry) => entry.executionId === executionId) ?? null;
  }

  async saveSignals(signals: LearnedSignal[]): Promise<void> {
    for (const signal of signals) {
      if (this.signals.some((entry) => entry.id === signal.id)) {
        throw new LearningConflictError(`Signal ${signal.id} already exists`, {
          rule: signal.rule,
          storeId: signal.storeId,
        });
      }
    }
    this.signals.push(...signals);
  }

  async listSignals(filter: LearningFilter = {}): Promise<LearnedSignal[]> {
    return applyFilter(this.signals, filter, (entry) => entry.timestamp);
  }

  async reset(): Promise<void> {
    this.feedback = [];
    this.outcomes = [];
    this.signals = [];
  }
}

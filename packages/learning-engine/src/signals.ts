/**
 * RL-style signal generation. Derives rewards from outcome history and
 * feedback so downstream automation (e.g. scheduling, exploration budgets)
 * can reinforce actions that measurably work and dampen ones that do not.
 */

import type { LearningStore } from './store.js';
import type {
  FeedbackRecord,
  LearnedSignal,
  OutcomeRecord,
  SignalGenerationResult,
  SignalKind,
} from './types.js';
import { clamp, firstDefinedStoreId, newLearningId } from './utils.js';

export interface SignalGeneratorOptions {
  /** Attempts needed before an outcome-derived signal reaches full confidence. */
  minSamples?: number;
  storeId?: string;
  now?: () => string;
}

export class SignalGenerator {
  constructor(private readonly store: LearningStore) {}

  async generate(options: SignalGeneratorOptions = {}): Promise<SignalGenerationResult> {
    const filter = options.storeId === undefined ? {} : { storeId: options.storeId };
    const [outcomes, feedback] = await Promise.all([
      this.store.listOutcomes(filter),
      this.store.listFeedback(filter),
    ]);
    const minSamples = options.minSamples ?? 10;
    const now = options.now ?? (() => new Date().toISOString());

    const signals: LearnedSignal[] = [];
    for (const [rule, records] of groupByRule(outcomes)) {
      signals.push(outcomeSignal(rule, records, minSamples, now));
    }
    for (const [rule, records] of groupFeedbackByRule(feedback)) {
      signals.push(feedbackSignal(rule, records, now));
    }

    return { signals, generatedAt: now() };
  }
}

function groupByRule(records: OutcomeRecord[]): Map<string, OutcomeRecord[]> {
  const byRule = new Map<string, OutcomeRecord[]>();
  for (const record of records) {
    const rule = record.rule ?? 'unknown';
    const bucket = byRule.get(rule) ?? [];
    bucket.push(record);
    byRule.set(rule, bucket);
  }
  return byRule;
}

function groupFeedbackByRule(records: FeedbackRecord[]): Map<string, FeedbackRecord[]> {
  const byRule = new Map<string, FeedbackRecord[]>();
  for (const record of records) {
    const rule = record.rule ?? 'feedback';
    const bucket = byRule.get(rule) ?? [];
    bucket.push(record);
    byRule.set(rule, bucket);
  }
  return byRule;
}

function outcomeSignal(
  rule: string,
  records: OutcomeRecord[],
  minSamples: number,
  now: () => string,
): LearnedSignal {
  const attempts = records.length;
  const successes = records.reduce((count, outcome) => (outcome.status === 'SUCCESS' ? count + 1 : count), 0);
  const successRate = successes / attempts;
  const reward = clamp((successRate - 0.5) * 2, -1, 1);
  return {
    id: newLearningId(`outcome:${rule}`),
    storeId: firstDefinedStoreId(records),
    rule,
    kind: kindOf(reward),
    reward,
    confidence: clamp(attempts / minSamples, 0, 1),
    source: 'outcome',
    timestamp: now(),
  };
}

function feedbackSignal(
  rule: string,
  records: FeedbackRecord[],
  now: () => string,
): LearnedSignal {
  const total = records.length;
  const positive = records.reduce((count, record) => (record.rating === 1 ? count + 1 : count), 0);
  const negative = records.reduce((count, record) => (record.rating === -1 ? count + 1 : count), 0);
  const reward = clamp((positive - negative) / total, -1, 1);
  return {
    id: newLearningId(`feedback:${rule}`),
    storeId: firstDefinedStoreId(records),
    rule,
    kind: kindOf(reward),
    reward,
    confidence: clamp(total / 5, 0, 1),
    source: 'feedback',
    timestamp: now(),
  };
}

function kindOf(reward: number): SignalKind {
  if (reward >= 0.2) return 'positive';
  if (reward <= -0.2) return 'negative';
  return 'neutral';
}

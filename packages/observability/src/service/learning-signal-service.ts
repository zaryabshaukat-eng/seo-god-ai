/**
 * Computes learning signals per repeatable action. Each signal is compatible
 * with the decision engine's `HistoricalOutcome` shape so it can be fed
 * straight into decision planning.
 */

import type { ObservabilityStore } from '../store/observability-store.js';
import type { ExecutionRecord, SeoSnapshot } from '../types/models.js';
import type { HistoricalOutcome, LearningSignal } from '../types/signals.js';

export interface LearningSignalOptions {
  storeId?: string;
}

/** Maps each execution to its measured SEO impact (AFTER minus BEFORE score). */
function measureImpact(snapshots: SeoSnapshot[]): Map<string, number> {
  const after = snapshots.filter((snapshot) => snapshot.reference === 'AFTER');
  const impactByExecution = new Map<string, number>();
  for (const snapshot of after) {
    if (snapshot.executionId === undefined) continue;
    const before = snapshots
      .filter(
        (candidate) =>
          candidate.storeId === snapshot.storeId &&
          candidate.reference === 'BEFORE' &&
          candidate.capturedAt < snapshot.capturedAt,
      )
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
    if (before !== undefined) {
      impactByExecution.set(snapshot.executionId, snapshot.overallScore - before.overallScore);
    }
  }
  return impactByExecution;
}

export class LearningSignalService {
  constructor(private readonly store: ObservabilityStore) {}

  async compute(options: LearningSignalOptions = {}): Promise<LearningSignal[]> {
    const [executions, snapshots] = await Promise.all([
      this.store.listExecutions(options.storeId === undefined ? {} : { storeId: options.storeId }),
      this.store.listSnapshots(options.storeId === undefined ? {} : { storeId: options.storeId }),
    ]);
    const impactByExecution = measureImpact(snapshots);

    const byRule = new Map<string, ExecutionRecord[]>();
    for (const record of executions) {
      const rule = record.operation ?? record.entityType ?? 'execution';
      const records = byRule.get(rule) ?? [];
      records.push(record);
      byRule.set(rule, records);
    }

    const signals: LearningSignal[] = [];
    for (const [rule, records] of byRule) {
      const attempts = records.length;
      const completed = records.reduce(
        (count, record) => (record.status === 'COMPLETED' ? count + 1 : count),
        0,
      );
      const rolledBack = records.reduce(
        (count, record) => (record.status === 'ROLLED_BACK' ? count + 1 : count),
        0,
      );

      const impacts = records
        .map((record) => impactByExecution.get(record.executionId))
        .filter((impact): impact is number => impact !== undefined);
      const averageImpact = impacts.length === 0 ? 0 : impacts.reduce((sum, value) => sum + value, 0) / impacts.length;

      const durations = records
        .map((record) => record.durationMs)
        .filter((duration): duration is number => duration !== undefined);
      const averageDurationMs =
        durations.length === 0 ? 0 : durations.reduce((sum, value) => sum + value, 0) / durations.length;

      const last = records[0];
      signals.push({
        rule,
        actionType: rule,
        storeId: options.storeId ?? records[0]?.storeId,
        attempts,
        successes: completed,
        averageImpact,
        successRate: attempts === 0 ? 0 : completed / attempts,
        rollbackRate: attempts === 0 ? 0 : rolledBack / attempts,
        averageDurationMs,
        lastExecutedAt: last?.startedAt,
      });
    }

    return signals.sort((a, b) => b.attempts - a.attempts);
  }
}

/** Projects a learning signal into the decision engine's `HistoricalOutcome`. */
export function toHistoricalOutcome(signal: LearningSignal): HistoricalOutcome {
  return {
    rule: signal.rule,
    attempts: signal.attempts,
    successes: signal.successes,
    averageImpact: signal.averageImpact,
  };
}

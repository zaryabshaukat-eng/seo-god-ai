/**
 * Outcome analysis. Turns raw execution outcomes into per-rule performance
 * rollups (attempts, success/rollback rates, average impact and duration) plus
 * a whole-set summary.
 */

import type { LearningStore } from './store.js';
import type {
  AnalysisSummary,
  LearningFilter,
  OutcomeAnalysis,
  OutcomeRecord,
  RulePerformance,
} from './types.js';
import { average, latestCreatedAt } from './utils.js';

export class OutcomeAnalyzer {
  constructor(private readonly store: LearningStore) {}

  async analyze(filter: LearningFilter = {}): Promise<OutcomeAnalysis> {
    const outcomes = await this.store.listOutcomes(filter);
    const byRule = new Map<string, OutcomeRecord[]>();
    for (const outcome of outcomes) {
      const rule = outcome.rule ?? 'unknown';
      const bucket = byRule.get(rule) ?? [];
      bucket.push(outcome);
      byRule.set(rule, bucket);
    }

    const rules: RulePerformance[] = [];
    for (const [rule, records] of byRule) {
      rules.push(performancesOf(rule, records));
    }
    rules.sort((a, b) => b.attempts - a.attempts);

    const impacts = outcomes
      .map((outcome) => outcome.impact)
      .filter((impact): impact is number => impact !== undefined);

    const summary: AnalysisSummary = {
      totalOutcomes: outcomes.length,
      rulesAnalyzed: rules.length,
      overallSuccessRate:
        outcomes.length === 0 ? 0 : outcomes.filter((outcome) => outcome.status === 'SUCCESS').length / outcomes.length,
      overallAverageImpact: average(impacts),
    };
    return { rules, summary };
  }
}

function performancesOf(rule: string, records: OutcomeRecord[]): RulePerformance {
  const successes = records.filter((outcome) => outcome.status === 'SUCCESS').length;
  const failures = records.filter((outcome) => outcome.status === 'FAILURE').length;
  const skipped = records.filter((outcome) => outcome.status === 'SKIPPED').length;
  const rolledBack = records.filter((outcome) => outcome.status === 'ROLLED_BACK').length;
  const attempts = records.length;
  const impacts = records
    .map((outcome) => outcome.impact)
    .filter((impact): impact is number => impact !== undefined);
  const durations = records
    .map((outcome) => outcome.durationMs)
    .filter((duration): duration is number => duration !== undefined);
  return {
    rule,
    attempts,
    successes,
    failures,
    skipped,
    rolledBack,
    successRate: successes / attempts,
    rollbackRate: rolledBack / attempts,
    averageImpact: average(impacts),
    averageDurationMs: average(durations),
    lastExecutedAt: latestCreatedAt(records),
  };
}

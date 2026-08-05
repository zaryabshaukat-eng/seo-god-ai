/**
 * Historical outcome processing. Projects analyzed rule performance into the
 * decision engine's `HistoricalOutcome` shape and merges it with any existing
 * outcomes so the decision context can be refreshed incrementally.
 */

import type { HistoricalOutcomeResult, RulePerformance } from './types.js';

export interface HistoricalOutcomeMergeOptions {
  /** Outcomes already known (e.g. persisted in a previous cycle). */
  existing?: HistoricalOutcomeResult[];
}

export class HistoricalOutcomeProcessor {
  constructor(private readonly performances: RulePerformance[] = []) {}

  process(options: HistoricalOutcomeMergeOptions = {}): HistoricalOutcomeResult[] {
    const merged = new Map<string, HistoricalOutcomeResult>();
    for (const outcome of options.existing ?? []) {
      merged.set(outcome.rule, { ...outcome });
    }
    for (const performance of this.performances) {
      const existing = merged.get(performance.rule);
      if (existing === undefined) {
        merged.set(performance.rule, {
          rule: performance.rule,
          attempts: performance.attempts,
          successes: performance.successes,
          averageImpact: performance.averageImpact,
        });
        continue;
      }
      const attempts = existing.attempts + performance.attempts;
      const successes = existing.successes + performance.successes;
      const averageImpact =
        attempts === 0
          ? 0
          : (existing.averageImpact * existing.attempts + performance.averageImpact * performance.attempts) / attempts;
      merged.set(performance.rule, {
        rule: performance.rule,
        attempts,
        successes,
        averageImpact,
      });
    }
    return [...merged.values()].sort((a, b) => a.rule.localeCompare(b.rule));
  }
}

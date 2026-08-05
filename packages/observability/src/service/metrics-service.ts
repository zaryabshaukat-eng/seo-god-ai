/**
 * Aggregates execution metrics from the observability store. Rates are
 * computed over terminal executions; durations come from completed runs.
 */

import type { ObservabilityStore } from '../store/observability-store.js';
import type { ExecutionMetricsSummary } from '../types/signals.js';

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export class MetricsService {
  constructor(private readonly store: ObservabilityStore) {}

  async compute(storeId?: string): Promise<ExecutionMetricsSummary> {
    const filter = storeId === undefined ? {} : { storeId };
    const executions = await this.store.listExecutions(filter);
    const events = await this.store.listEvents(filter);

    let queued = 0;
    let executing = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let rolledBack = 0;
    let simulated = 0;
    const durations: number[] = [];

    for (const record of executions) {
      switch (record.status) {
        case 'QUEUED':
          queued += 1;
          break;
        case 'EXECUTING':
          executing += 1;
          break;
        case 'COMPLETED':
          completed += 1;
          if (record.durationMs !== undefined) durations.push(record.durationMs);
          break;
        case 'FAILED':
          failed += 1;
          break;
        case 'CANCELLED':
          cancelled += 1;
          break;
        case 'ROLLED_BACK':
          rolledBack += 1;
          break;
      }
      if (record.simulation === true) simulated += 1;
    }

    const terminal = completed + failed + cancelled + rolledBack;

    let validationFailures = 0;
    let safetyViolations = 0;
    let totalRollbacks = 0;
    let crawlCompleted = 0;
    let crawlFailed = 0;
    for (const event of events) {
      switch (event.type) {
        case 'validation.failed':
          validationFailures += 1;
          break;
        case 'execution.safety_violation':
          safetyViolations += 1;
          break;
        case 'execution.rollback_completed':
          totalRollbacks += 1;
          break;
        case 'crawl.completed':
          crawlCompleted += 1;
          break;
        case 'crawl.failed':
          crawlFailed += 1;
          break;
        default:
          break;
      }
    }

    const averageDurationMs =
      durations.length === 0 ? 0 : durations.reduce((sum, value) => sum + value, 0) / durations.length;

    return {
      totalExecutions: executions.length,
      queued,
      executing,
      completed,
      failed,
      cancelled,
      rolledBack,
      successRate: rate(completed, terminal),
      failureRate: rate(failed, terminal),
      rollbackRate: rate(rolledBack, terminal),
      averageExecutionTimeMs: averageDurationMs,
      p95ExecutionTimeMs: percentile(durations, 95),
      validationFailures,
      safetyViolations,
      totalRollbacks,
      crawlSuccessRate: rate(crawlCompleted, crawlCompleted + crawlFailed),
      simulated,
    };
  }
}

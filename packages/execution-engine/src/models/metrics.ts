import type { Execution } from '../types/execution.js';
import type { ExecutionMetrics } from '../types/metrics.js';
import { deterministicUuid } from '../utils/ids.js';

export interface MetricsInput {
  startedAt: Date;
  completedAt: Date;
  apiCalls?: number;
  rollbacks?: number;
}

/** Builds the per-execution metrics record from the execution state. */
export function buildMetrics(execution: Execution, input: MetricsInput): ExecutionMetrics {
  const durationMs = Math.max(0, input.completedAt.getTime() - input.startedAt.getTime());
  const stepTimes = execution.steps
    .map((step) => step.durationMs)
    .filter((value): value is number => value !== null);
  const averageStepTimeMs =
    stepTimes.length > 0 ? Math.round(stepTimes.reduce((sum, value) => sum + value, 0) / stepTimes.length) : 0;
  const batchSize =
    execution.batches.length > 0
      ? Math.round((execution.steps.length / execution.batches.length) * 100) / 100
      : 0;
  const writeRate =
    durationMs > 0 ? Math.round(((input.apiCalls ?? 0) * 60000) / durationMs * 100) / 100 : 0;
  return {
    executionId: execution.id,
    storeId: execution.storeId,
    mode: execution.mode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs,
    totalSteps: execution.steps.length,
    completed: execution.summary.completed,
    simulated: execution.summary.simulated,
    failed: execution.summary.failed,
    skipped: execution.summary.skipped,
    cancelled: execution.summary.cancelled,
    rolledBack: execution.summary.rolledBack,
    apiCalls: input.apiCalls ?? execution.summary.apiCalls,
    writeRate,
    batchSize,
    rollbacks: input.rollbacks ?? 0,
    averageStepTimeMs,
    createdAt: new Date(),
  };
}

export function metricsId(executionId: string): string {
  return deterministicUuid(`${executionId}|metrics`);
}

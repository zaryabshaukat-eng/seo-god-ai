import type { ExecutionReport, FailureDetail, WorkflowExecution } from '../types/execution.js';
import { errorMessage } from '../utils/retry.js';

/**
 * Builds the final {@link ExecutionReport} from a finished workflow
 * execution: per-status step tallies, failure details, agent results, and
 * aggregate token/cost figures.
 */
export class ExecutionReportModel {
  static fromExecution(execution: WorkflowExecution): ExecutionReport {
    const steps = execution.steps;
    const total = steps.length;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let skipped = 0;
    for (const step of steps) {
      if (step.status === 'COMPLETED') completed += 1;
      else if (step.status === 'FAILED') failed += 1;
      else if (step.status === 'SKIPPED') skipped += 1;
      else cancelled += 1;
    }

    const failures: FailureDetail[] = steps
      .filter((step) => step.status === 'FAILED' && step.error !== null)
      .map((step) => ({
        stepId: step.stepId,
        name: step.stepId,
        attempt: step.attempt,
        error: step.error as string,
        retryable: false,
      }));

    const agentResults = Object.values(execution.outputs);
    const totalTokens = agentResults.reduce(
      (sum, result) => sum + result.tokens.totalTokens,
      0,
    );
    const costEstimate = agentResults.reduce(
      (sum, result) => sum + result.costEstimate,
      0,
    );

    return {
      executionId: execution.id,
      workflowName: execution.name,
      status: execution.status,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      durationMs:
        execution.completedAt === null
          ? null
          : execution.completedAt.getTime() - execution.startedAt.getTime(),
      steps: { total, completed, failed, cancelled, skipped },
      failures,
      agentResults,
      totalTokens,
      costEstimate,
    };
  }

  /** Aggregates error messages across failed steps. */
  static failureSummary(execution: WorkflowExecution): string | null {
    const failedSteps = execution.steps.filter((step) => step.status === 'FAILED');
    if (failedSteps.length === 0) return null;
    return failedSteps
      .map((step) => `${step.stepId}: ${step.error ?? 'failed'}`)
      .join('; ');
  }

  /** Normalizes an unknown thrown value for report/status fields. */
  static message(error: unknown): string {
    return errorMessage(error);
  }
}

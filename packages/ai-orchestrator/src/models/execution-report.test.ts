import { describe, expect, it } from 'vitest';
import type { WorkflowExecution } from '../types/execution.js';
import type { StepExecution } from '../types/execution.js';
import { ExecutionReportModel } from './execution-report.js';
import { agentResult } from '../test/fixtures.js';

function step(overrides: Partial<StepExecution>): StepExecution {
  return {
    id: 'step-id',
    stepId: 's1',
    kind: 'agent',
    status: 'COMPLETED',
    attempt: 1,
    error: null,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-01T00:00:01Z'),
    ...overrides,
  };
}

function execution(overrides: Partial<WorkflowExecution> = {}): WorkflowExecution {
  return {
    id: 'exec-1',
    definitionId: 'def-1',
    definitionVersion: 1,
    name: 'plan-workflow',
    storeId: 'store-1',
    status: 'COMPLETED',
    inputs: {},
    outputs: { s1: agentResult() },
    steps: [],
    startedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-01T00:00:02Z'),
    error: null,
    cancelledAt: null,
    checkpointedAt: null,
    ...overrides,
  };
}

describe('ExecutionReportModel', () => {
  it('builds a report with step tallies, failures, and aggregates', () => {
    const report = ExecutionReportModel.fromExecution(
      execution({
        steps: [
          step({ stepId: 's1', status: 'COMPLETED' }),
          step({ stepId: 's2', status: 'FAILED', error: 'boom' }),
          step({ stepId: 's3', status: 'SKIPPED' }),
          step({ stepId: 's4', status: 'PENDING' }),
        ],
      }),
    );
    expect(report.status).toBe('COMPLETED');
    expect(report.durationMs).toBe(2000);
    expect(report.steps).toEqual({ total: 4, completed: 1, failed: 1, cancelled: 1, skipped: 1 });
    expect(report.failures).toEqual([
      expect.objectContaining({ stepId: 's2', error: 'boom', attempt: 1 }),
    ]);
    expect(report.totalTokens).toBe(agentResult().tokens.totalTokens);
    expect(report.costEstimate).toBe(agentResult().costEstimate);
    expect(report.agentResults).toHaveLength(1);
  });

  it('returns null duration when the workflow never completed', () => {
    const report = ExecutionReportModel.fromExecution(execution({ completedAt: null }));
    expect(report.durationMs).toBeNull();
  });

  it('produces null failure summary when nothing failed', () => {
    expect(ExecutionReportModel.failureSummary(execution())).toBeNull();
  });

  it('joins failure messages in the summary', () => {
    const summary = ExecutionReportModel.failureSummary(
      execution({
        steps: [
          step({ stepId: 's1', status: 'FAILED', error: 'boom' }),
          step({ stepId: 's2', status: 'FAILED', error: null }),
        ],
      }),
    );
    expect(summary).toBe('s1: boom; s2: failed');
  });

  it('normalizes unknown thrown values', () => {
    expect(ExecutionReportModel.message(new Error('boom'))).toBe('boom');
    expect(ExecutionReportModel.message('boom')).toBe('boom');
  });
});

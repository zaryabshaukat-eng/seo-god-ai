import { describe, expect, it } from 'vitest';
import type { ExecutionResult } from '@seogod/decision-engine';
import type { ExecutionRecord, LearningSignal } from '@seogod/observability';
import {
  fromExecutionRecord,
  fromExecutionResult,
  fromObservabilitySignal,
} from './adapters.js';

describe('fromExecutionResult', () => {
  it('maps a success result with a completed date', () => {
    const result = fromExecutionResult(
      {
        id: 'e1',
        storeId: 's1',
        taskId: 't1',
        status: 'SUCCESS',
        durationMs: 10,
        completedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
      'missing-title',
    );
    expect(result).toEqual({
      executionId: 'e1',
      storeId: 's1',
      rule: 'missing-title',
      status: 'SUCCESS',
      durationMs: 10,
      createdAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('maps a failure without a completed date or rule', () => {
    const result = fromExecutionResult({ id: 'e2', storeId: 's1', status: 'FAILURE', durationMs: 5 });
    expect(result.createdAt).toBeUndefined();
    expect(result.status).toBe('FAILURE');
    expect(result.rule).toBeUndefined();
  });

  it('maps a skipped status', () => {
    expect(fromExecutionResult({ id: 'e3', storeId: 's1', status: 'SKIPPED' }).status).toBe('SKIPPED');
  });
});

describe('fromExecutionRecord', () => {
  it('maps terminal records to outcomes', () => {
    expect(
      fromExecutionRecord({
        executionId: 'e1',
        storeId: 's1',
        operation: 'update_title',
        status: 'COMPLETED',
        completedAt: '2024-01-01T00:00:00.000Z',
      }),
    ).toMatchObject({ status: 'SUCCESS', rule: 'update_title' });
    expect(fromExecutionRecord({ executionId: 'e2', storeId: 's1', status: 'FAILED' })?.status).toBe(
      'FAILURE',
    );
    expect(
      fromExecutionRecord({ executionId: 'e3', storeId: 's1', status: 'CANCELLED' })?.status,
    ).toBe('SKIPPED');
    expect(
      fromExecutionRecord({ executionId: 'e4', storeId: 's1', status: 'ROLLED_BACK' })?.status,
    ).toBe('ROLLED_BACK');
  });

  it('returns null for non-terminal records', () => {
    expect(fromExecutionRecord({ executionId: 'e5', storeId: 's1', status: 'QUEUED' })).toBeNull();
    expect(
      fromExecutionRecord({ executionId: 'e6', storeId: 's1', status: 'EXECUTING' }),
    ).toBeNull();
  });

  it('falls back to startedAt when completedAt is missing', () => {
    expect(
      fromExecutionRecord({
        executionId: 'e7',
        storeId: 's1',
        status: 'COMPLETED',
        startedAt: '2024-01-02T00:00:00.000Z',
      })?.createdAt,
    ).toBe('2024-01-02T00:00:00.000Z');
  });
});

describe('fromObservabilitySignal', () => {
  it('projects a learning signal to a historical outcome', () => {
    expect(
      fromObservabilitySignal({ rule: 'r1', attempts: 10, successes: 8, averageImpact: 12 }),
    ).toEqual({ rule: 'r1', attempts: 10, successes: 8, averageImpact: 12 });
  });
});

describe('structural compatibility with platform types', () => {
  it('accepts a real decision-engine ExecutionResult', () => {
    const real: ExecutionResult = {
      id: 'r1',
      taskId: 't1',
      planId: 'p1',
      storeId: 's1',
      status: 'SUCCESS',
      durationMs: 10,
      message: 'ok',
      apiResponses: [],
      startedAt: new Date(),
      completedAt: new Date(),
    };
    expect(fromExecutionResult(real, 'missing-title').status).toBe('SUCCESS');
  });

  it('accepts a real observability ExecutionRecord', () => {
    const real: ExecutionRecord = {
      executionId: 'r2',
      storeId: 's1',
      operation: 'update_title',
      entityType: 'page',
      status: 'COMPLETED',
      startedAt: '2024-01-01T00:00:00.000Z',
      completedAt: '2024-01-01T00:00:01.000Z',
    };
    const outcome = fromExecutionRecord(real);
    expect(outcome?.status).toBe('SUCCESS');
    expect(outcome?.rule).toBe('update_title');
  });

  it('accepts a real observability LearningSignal', () => {
    const real: LearningSignal = {
      rule: 'missing-title',
      actionType: 'update_title',
      attempts: 10,
      successes: 8,
      averageImpact: 12,
      successRate: 0.8,
      rollbackRate: 0,
      averageDurationMs: 100,
    };
    expect(fromObservabilitySignal(real)).toEqual({
      rule: 'missing-title',
      attempts: 10,
      successes: 8,
      averageImpact: 12,
    });
  });
});

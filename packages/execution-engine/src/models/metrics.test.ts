import { describe, expect, it } from 'vitest';
import { buildStep, buildExecution } from './execution.js';
import { buildMetrics, metricsId } from './metrics.js';
import { isUuid } from '../utils/ids.js';

function sampleExecution() {
  const steps = [
    buildStep({ executionId: 'e1', batchId: 'b1', storeId: 's1', actionType: 'update_title', resourceType: 'product', resourceId: 'p1', payload: {}, order: 0 }),
    buildStep({ executionId: 'e1', batchId: 'b1', storeId: 's1', actionType: 'update_title', resourceType: 'product', resourceId: 'p2', payload: {}, order: 1 }),
    buildStep({ executionId: 'e1', batchId: 'b1', storeId: 's1', actionType: 'update_title', resourceType: 'product', resourceId: 'p3', payload: {}, order: 2 }),
  ];
  steps[0]!.status = 'COMPLETED';
  steps[0]!.durationMs = 100;
  steps[1]!.status = 'FAILED';
  steps[1]!.durationMs = 300;
  steps[2]!.status = 'SIMULATED';
  steps[2]!.durationMs = 200;
  const batches = [buildStepToBatch(steps)];
  return buildExecution({ id: 'exec-1', storeId: 's1', mode: 'PRODUCTION', source: 'plan', steps, batches });
}

function buildStepToBatch(steps: Array<{ id: string }>) {
  const now = new Date();
  return {
    id: 'batch-1',
    executionId: 'e1',
    storeId: 's1',
    resourceType: 'product',
    actionType: 'update_title',
    stepIds: steps.map((s) => s.id),
    order: 0,
    status: 'COMPLETED' as const,
    apiCalls: 0,
    createdAt: now,
    updatedAt: now,
  };
}

describe('metrics model', () => {
  it('buildMetrics aggregates execution stats', () => {
    const execution = sampleExecution();
    const startedAt = new Date('2025-01-01T00:00:00Z');
    const completedAt = new Date('2025-01-01T00:00:10Z');
    const metrics = buildMetrics(execution, { startedAt, completedAt, apiCalls: 7, rollbacks: 1 });
    expect(metrics.executionId).toBe('exec-1');
    expect(metrics.mode).toBe('PRODUCTION');
    expect(metrics.durationMs).toBe(10_000);
    expect(metrics.totalSteps).toBe(3);
    expect(metrics.completed).toBe(1);
    expect(metrics.failed).toBe(1);
    expect(metrics.simulated).toBe(1);
    expect(metrics.apiCalls).toBe(7);
    expect(metrics.rollbacks).toBe(1);
    expect(metrics.averageStepTimeMs).toBe(200);
    expect(metrics.writeRate).toBeCloseTo(42);
    expect(metrics.batchSize).toBe(3);
    expect(metrics.createdAt).toBeInstanceOf(Date);
  });

  it('buildMetrics defaults apiCalls to summary and handles zero duration', () => {
    const execution = sampleExecution();
    const now = new Date();
    const metrics = buildMetrics(execution, { startedAt: now, completedAt: now });
    expect(metrics.apiCalls).toBe(execution.summary.apiCalls);
    expect(metrics.durationMs).toBe(0);
    expect(metrics.writeRate).toBe(0);
  });

  it('buildMetrics guards division by zero for batches and durations', () => {
    const execution = buildExecution({ storeId: 's', mode: 'DRY_RUN', source: 'actions', steps: [], batches: [] });
    const now = new Date();
    const metrics = buildMetrics(execution, { startedAt: now, completedAt: now });
    expect(metrics.batchSize).toBe(0);
    expect(metrics.averageStepTimeMs).toBe(0);
    expect(metrics.writeRate).toBe(0);
  });

  it('metricsId is a stable uuid', () => {
    const a = metricsId('exec-1');
    const b = metricsId('exec-1');
    const c = metricsId('exec-2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(isUuid(a)).toBe(true);
  });
});

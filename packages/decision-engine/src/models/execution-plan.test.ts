import { describe, expect, it } from 'vitest';
import { fixedClock, STORE_ID, task } from '../test/fixtures.js';
import { ExecutionPlanModel } from './execution-plan.js';
import type { ExecutionBatch } from '../types/plan.js';

function batch(id: string): ExecutionBatch {
  return {
    id,
    storeId: STORE_ID,
    planId: 'plan-1',
    resourceType: 'page',
    actionType: 'update_title',
    taskIds: [],
    order: 0,
    status: 'PENDING',
    estimatedSeconds: 10,
    apiCalls: 1,
  };
}

function makePlan() {
  return ExecutionPlanModel.create({
    id: 'plan-1',
    storeId: STORE_ID,
    decisionId: 'decision-1',
    version: 1,
    tasks: [task({ id: 't1' }), task({ id: 't2' })],
    batches: [batch('batch-1')],
    orderedTaskIds: ['t1', 't2'],
    dependencies: [],
    estimatedDurationMinutes: 2,
    totalEffortHours: 1.5,
    totalImpact: 80,
    risk: 'MEDIUM',
    now: fixedClock,
  });
}

describe('ExecutionPlanModel.create', () => {
  it('creates a draft plan and copies arrays', () => {
    const plan = makePlan();
    expect(plan.status).toBe('DRAFT');
    expect(plan.version).toBe(1);
    expect(plan.approvalRequestId).toBeNull();
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0]).not.toBe(makePlan().tasks[0]);
    expect(plan.batches[0]).not.toBe(makePlan().batches[0]);
  });
});

describe('ExecutionPlanModel transitions', () => {
  it('sets status and approval request id', () => {
    const plan = makePlan();
    const approved = ExecutionPlanModel.setStatus(plan, 'APPROVED', fixedClock);
    expect(approved.status).toBe('APPROVED');
    expect(plan.status).toBe('DRAFT');
    const withRequest = ExecutionPlanModel.setApprovalRequestId(plan, 'request-1');
    expect(withRequest.approvalRequestId).toBe('request-1');
  });

  it('updates a single task status', () => {
    const plan = makePlan();
    const running = ExecutionPlanModel.setTaskStatus(plan, 't1', 'IN_PROGRESS', fixedClock);
    expect(ExecutionPlanModel.taskById(running, 't1')?.status).toBe('IN_PROGRESS');
    expect(ExecutionPlanModel.taskById(running, 't2')?.status).toBe('PENDING');
    expect(ExecutionPlanModel.taskById(running, 'missing')).toBeUndefined();
  });

  it('attaches a result to a task', () => {
    const plan = makePlan();
    const result = {
      id: 'result-1',
      taskId: 't1',
      planId: 'plan-1',
      storeId: STORE_ID,
      status: 'SUCCESS' as const,
      durationMs: 10,
      message: 'ok',
      apiResponses: [],
      startedAt: fixedClock(),
      completedAt: fixedClock(),
    };
    const updated = ExecutionPlanModel.setTaskResult(plan, 't1', result);
    expect(ExecutionPlanModel.taskById(updated, 't1')?.result?.status).toBe('SUCCESS');
  });

  it('sets the status of every batch', () => {
    const plan = makePlan();
    const running = ExecutionPlanModel.setBatchStatuses(plan, 'IN_PROGRESS');
    expect(running.batches[0]?.status).toBe('IN_PROGRESS');
    expect(plan.batches[0]?.status).toBe('PENDING');
  });

  it('copies records on fromRecord', () => {
    const plan = makePlan();
    const copy = ExecutionPlanModel.fromRecord(plan);
    expect(copy.tasks[0]).not.toBe(plan.tasks[0]);
    expect(copy.orderedTaskIds).not.toBe(plan.orderedTaskIds);
    expect(copy.dependencies).not.toBe(plan.dependencies);
  });
});

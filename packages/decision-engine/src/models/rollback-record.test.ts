import { describe, expect, it } from 'vitest';
import { fixedClock, ORIGIN, STORE_ID } from '../test/fixtures.js';
import { planRolledBack, RollbackRecordModel } from './rollback-record.js';
import type { ExecutionPlan } from '../types/plan.js';
import type { RollbackPlan } from '../types/result.js';

function makeRollback(): RollbackPlan {
  return {
    taskId: 't1',
    storeId: STORE_ID,
    planId: 'plan-1',
    actionType: 'update_title',
    resourceType: 'page',
    resourceId: `${ORIGIN}/p/1`,
    available: true,
    reason: 'previous field values will be restored',
    steps: [
      {
        action: 'restore_field',
        resourceType: 'page',
        resourceId: `${ORIGIN}/p/1`,
        payload: { field: 'title', value: 'Old title' },
      },
    ],
  };
}

function makeRecord() {
  return RollbackRecordModel.create({
    planId: 'plan-1',
    taskId: 't1',
    storeId: STORE_ID,
    rollback: makeRollback(),
    reason: 'user asked',
    now: fixedClock,
  });
}

describe('RollbackRecordModel', () => {
  it('creates a pending record with copied steps', () => {
    const record = makeRecord();
    expect(record.status).toBe('PENDING');
    expect(record.steps[0]?.payload).toEqual({ field: 'title', value: 'Old title' });
    expect(record.error).toBeNull();
    expect(record.completedAt).toBeNull();
    expect(record.startedAt).toEqual(fixedClock());
  });

  it('copies records on fromRecord', () => {
    const record = makeRecord();
    const copy = RollbackRecordModel.fromRecord(record);
    expect(copy).toEqual(record);
  });

  it('completes, fails, and sets status immutably', () => {
    const record = makeRecord();
    const done = RollbackRecordModel.complete(record, fixedClock());
    expect(done.status).toBe('COMPLETED');
    expect(done.completedAt).toEqual(fixedClock());
    const failed = RollbackRecordModel.fail(record, 'boom', fixedClock());
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toBe('boom');
    const set = RollbackRecordModel.setStatus(record, 'PENDING');
    expect(set.status).toBe('PENDING');
    expect(record.status).toBe('PENDING');
  });
});

describe('planRolledBack', () => {
  it('marks executed tasks rolled back and leaves pending tasks alone', () => {
    const plan: ExecutionPlan = {
      id: 'plan-1',
      storeId: STORE_ID,
      decisionId: 'decision-1',
      status: 'EXECUTING',
      version: 1,
      approvalRequestId: null,
      tasks: [
        {
          id: 'done',
          storeId: STORE_ID,
          decisionId: 'decision-1',
          planId: 'plan-1',
          recommendationId: 'rec-1',
          rule: 'missing-title',
          actionType: 'update_title',
          resourceType: 'page',
          resourceId: `${ORIGIN}/p/1`,
          resourceRef: `${ORIGIN}/p/1`,
          payload: {},
          priority: 80,
          status: 'COMPLETED',
          dependsOn: [],
          isMutating: true,
          risk: 'LOW',
          estimatedSeconds: 15,
          rollback: null,
          result: null,
          createdAt: fixedClock(),
          updatedAt: fixedClock(),
        },
        {
          id: 'pending',
          storeId: STORE_ID,
          decisionId: 'decision-1',
          planId: 'plan-1',
          recommendationId: 'rec-2',
          rule: 'thin-content',
          actionType: 'update_body',
          resourceType: 'page',
          resourceId: `${ORIGIN}/p/1`,
          resourceRef: `${ORIGIN}/p/1`,
          payload: {},
          priority: 70,
          status: 'PENDING',
          dependsOn: [],
          isMutating: true,
          risk: 'LOW',
          estimatedSeconds: 15,
          rollback: null,
          result: null,
          createdAt: fixedClock(),
          updatedAt: fixedClock(),
        },
      ],
      batches: [],
      orderedTaskIds: ['done', 'pending'],
      dependencies: [],
      estimatedDurationMinutes: 1,
      totalEffortHours: 0.5,
      totalImpact: 80,
      risk: 'LOW',
      createdAt: fixedClock(),
      updatedAt: fixedClock(),
    };
    const rolledBack = planRolledBack(plan, null, fixedClock);
    expect(rolledBack.status).toBe('ROLLED_BACK');
    expect(rolledBack.tasks.find((entry) => entry.id === 'done')?.status).toBe('ROLLED_BACK');
    expect(rolledBack.tasks.find((entry) => entry.id === 'pending')?.status).toBe('PENDING');
  });

  it('rolls back a single task by id', () => {
    const plan: ExecutionPlan = {
      id: 'plan-1',
      storeId: STORE_ID,
      decisionId: 'decision-1',
      status: 'EXECUTING',
      version: 1,
      approvalRequestId: null,
      tasks: [
        {
          id: 'one',
          storeId: STORE_ID,
          decisionId: 'decision-1',
          planId: 'plan-1',
          recommendationId: 'rec-1',
          rule: 'missing-title',
          actionType: 'update_title',
          resourceType: 'page',
          resourceId: `${ORIGIN}/p/1`,
          resourceRef: `${ORIGIN}/p/1`,
          payload: {},
          priority: 80,
          status: 'COMPLETED',
          dependsOn: [],
          isMutating: true,
          risk: 'LOW',
          estimatedSeconds: 15,
          rollback: null,
          result: null,
          createdAt: fixedClock(),
          updatedAt: fixedClock(),
        },
        {
          id: 'two',
          storeId: STORE_ID,
          decisionId: 'decision-1',
          planId: 'plan-1',
          recommendationId: 'rec-2',
          rule: 'thin-content',
          actionType: 'update_body',
          resourceType: 'page',
          resourceId: `${ORIGIN}/p/1`,
          resourceRef: `${ORIGIN}/p/1`,
          payload: {},
          priority: 70,
          status: 'COMPLETED',
          dependsOn: [],
          isMutating: true,
          risk: 'LOW',
          estimatedSeconds: 15,
          rollback: null,
          result: null,
          createdAt: fixedClock(),
          updatedAt: fixedClock(),
        },
      ],
      batches: [],
      orderedTaskIds: ['one', 'two'],
      dependencies: [],
      estimatedDurationMinutes: 1,
      totalEffortHours: 0.5,
      totalImpact: 80,
      risk: 'LOW',
      createdAt: fixedClock(),
      updatedAt: fixedClock(),
    };
    const rolledBack = planRolledBack(plan, 'one', fixedClock);
    expect(rolledBack.tasks.find((entry) => entry.id === 'one')?.status).toBe('ROLLED_BACK');
    expect(rolledBack.tasks.find((entry) => entry.id === 'two')?.status).toBe('COMPLETED');
  });
});

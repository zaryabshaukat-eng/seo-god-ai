import { describe, expect, it } from 'vitest';
import { decisionInput, fixedClock, ORIGIN, STORE_ID, task } from '../test/fixtures.js';
import { DecisionModel } from '../models/decision.js';
import { ExecutionPlanModel } from '../models/execution-plan.js';
import { ApprovalRequestModel } from '../models/approval-request.js';
import { RollbackRecordModel } from '../models/rollback-record.js';
import { Prioritizer } from '../prioritizer/prioritizer.js';
import { PrismaDecisionRepository, toStoredJson } from './decision-repository.js';
import type { DecisionEngineInput } from '../types/input.js';

type AnyRow = Record<string, unknown> & { id: string };

interface FakeDb {
  store: {
    decision: Map<string, AnyRow>;
    executionPlan: Map<string, AnyRow>;
    executionTask: Map<string, AnyRow>;
    planApprovalRequest: Map<string, AnyRow>;
    rollbackRecord: Map<string, AnyRow>;
  };
  client: unknown;
}

function fakeDb(): FakeDb {
  const store = {
    decision: new Map<string, AnyRow>(),
    executionPlan: new Map<string, AnyRow>(),
    executionTask: new Map<string, AnyRow>(),
    planApprovalRequest: new Map<string, AnyRow>(),
    rollbackRecord: new Map<string, AnyRow>(),
  };
  const tx = (maps: FakeDb['store']): any => ({
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx(maps)),
    decision: {
      upsert: async ({ where, create, update }: { where: { id: string }; create: AnyRow; update: AnyRow }) => {
        maps.decision.set(where.id, maps.decision.has(where.id) ? update : create);
        return maps.decision.get(where.id)!;
      },
      findUnique: async ({ where }: { where: { id: string } }) => maps.decision.get(where.id) ?? null,
    },
    executionPlan: {
      upsert: async ({ where, update }: { where: { id: string }; update: AnyRow }) => {
        maps.executionPlan.set(where.id, update);
        return update;
      },
      findUnique: async ({ where }: { where: { id: string } }) => maps.executionPlan.get(where.id) ?? null,
      findFirst: async ({ where }: { where: { decisionId: string } }) =>
        [...maps.executionPlan.values()]
          .filter((row) => row.decisionId === where.decisionId)
          .sort((a, b) => (b.version as number) - (a.version as number))[0] ?? null,
      findMany: async ({ where }: { where: { storeId: string } }) =>
        [...maps.executionPlan.values()].filter((row) => row.storeId === where.storeId),
    },
    executionTask: {
      upsert: async ({ where, update }: { where: { id: string }; update: AnyRow }) => {
        maps.executionTask.set(where.id, update);
        return update;
      },
      findMany: async ({ where }: { where: { planId: string } }) =>
        [...maps.executionTask.values()].filter((row) => row.planId === where.planId),
      update: async ({ where, data }: { where: { id: string }; data: Partial<AnyRow> }) => {
        const next = { ...(maps.executionTask.get(where.id) ?? {}), ...data } as AnyRow;
        maps.executionTask.set(where.id, next);
        return next;
      },
    },
    planApprovalRequest: {
      upsert: async ({ where, update }: { where: { id: string }; update: AnyRow }) => {
        maps.planApprovalRequest.set(where.id, update);
        return update;
      },
      findMany: async ({ where }: { where: { storeId: string } }) =>
        [...maps.planApprovalRequest.values()].filter((row) => row.storeId === where.storeId),
    },
    rollbackRecord: {
      upsert: async ({ where, update }: { where: { id: string }; update: AnyRow }) => {
        maps.rollbackRecord.set(where.id, update);
        return update;
      },
      findMany: async ({ where }: { where: { storeId: string } }) =>
        [...maps.rollbackRecord.values()].filter((row) => row.storeId === where.storeId),
    },
  });
  return { store, client: tx(store) };
}

function makeDecision() {
  const input: DecisionEngineInput = decisionInput();
  const prioritized = new Prioritizer().prioritize(input);
  return DecisionModel.create({
    input,
    prioritized,
    summary: { recommendationCount: 1, taskCount: 0, batchCount: 0, estimatedExecutionMinutes: 0, totalEffortHours: 0, totalImpact: 0, highRiskTaskCount: 0, approvalRequired: false },
    now: fixedClock,
  });
}

function makePlan(decisionId: string) {
  return ExecutionPlanModel.create({
    id: 'plan-1',
    storeId: STORE_ID,
    decisionId,
    version: 1,
    tasks: [task({ id: 't1' })],
    batches: [],
    orderedTaskIds: ['t1'],
    dependencies: [],
    estimatedDurationMinutes: 1,
    totalEffortHours: 0.5,
    totalImpact: 80,
    risk: 'LOW',
    now: fixedClock,
  });
}

describe('toStoredJson', () => {
  it('serializes JSON-safe values and drops functions', () => {
    expect(toStoredJson({ a: 1, b: 'x', c: [1, 2] })).toEqual({ a: 1, b: 'x', c: [1, 2] });
  });
});

describe('PrismaDecisionRepository', () => {
  it('persists and reads decisions', async () => {
    const db = fakeDb();
    const repository = new PrismaDecisionRepository(db.client as never);
    const decision = makeDecision();
    await repository.saveDecision(decision);
    expect(await repository.getDecision(decision.id)).toEqual(decision);
    expect(await repository.getDecision('missing')).toBeNull();
  });

  it('upserts decisions instead of duplicating', async () => {
    const db = fakeDb();
    const repository = new PrismaDecisionRepository(db.client as never);
    const decision = makeDecision();
    await repository.saveDecision(decision);
    const updated = DecisionModel.setStatus(decision, 'APPROVED', fixedClock);
    await repository.saveDecision(updated);
    expect(await repository.getDecision(decision.id)).toEqual(updated);
  });

  it('persists a plan with its tasks and reads it back', async () => {
    const db = fakeDb();
    const repository = new PrismaDecisionRepository(db.client as never);
    const decision = makeDecision();
    const plan = makePlan(decision.id);
    await repository.savePlan(plan);
    const read = await repository.getPlan(plan.id);
    expect(read?.status).toBe('DRAFT');
    expect(read?.tasks.map((entry) => entry.id)).toEqual(['t1']);
    expect(read?.orderedTaskIds).toEqual(['t1']);
  });

  it('returns null for missing plans and latest plans', async () => {
    const db = fakeDb();
    const repository = new PrismaDecisionRepository(db.client as never);
    expect(await repository.getPlan('missing')).toBeNull();
    expect(await repository.getPlanByDecision('no-decision')).toBeNull();
  });

  it('stores non-null rollback and result JSON on tasks', async () => {
    const db = fakeDb();
    const repository = new PrismaDecisionRepository(db.client as never);
    const decision = makeDecision();
    const plan = ExecutionPlanModel.create({
      id: 'plan-json',
      storeId: STORE_ID,
      decisionId: decision.id,
      version: 1,
      tasks: [
        task({
          id: 't-json',
          planId: 'plan-json',
          decisionId: decision.id,
          rollback: {
            taskId: 't-json',
            storeId: STORE_ID,
            planId: 'plan-json',
            actionType: 'update_title',
            resourceType: 'page',
            resourceId: `${ORIGIN}/p/1`,
            available: true,
            reason: 'previous field values will be restored',
            steps: [],
          },
          result: {
            id: 'result-t-json',
            taskId: 't-json',
            planId: 'plan-json',
            storeId: STORE_ID,
            status: 'SUCCESS',
            durationMs: 5,
            message: 'ok',
            apiResponses: [],
            startedAt: fixedClock(),
            completedAt: fixedClock(),
          },
        }),
      ],
      batches: [],
      orderedTaskIds: ['t-json'],
      dependencies: [],
      estimatedDurationMinutes: 1,
      totalEffortHours: 0.5,
      totalImpact: 80,
      risk: 'LOW',
      now: fixedClock,
    });
    await repository.savePlan(plan);
    const read = await repository.getPlan('plan-json');
    expect(read?.tasks[0]?.rollback?.available).toBe(true);
    expect(read?.tasks[0]?.result?.status).toBe('SUCCESS');
  });

  it('finds the latest plan for a decision and lists plans by store', async () => {
    const db = fakeDb();
    const repository = new PrismaDecisionRepository(db.client as never);
    const decision = makeDecision();
    const v1 = makePlan(decision.id);
    await repository.savePlan(v1);
    const v2 = ExecutionPlanModel.create({
      ...v1,
      id: 'plan-2',
      version: 2,
      now: fixedClock,
    });
    await repository.savePlan(v2);

    const latest = await repository.getPlanByDecision(decision.id);
    expect(latest?.version).toBe(2);
    expect((await repository.listPlans(STORE_ID)).map((entry) => entry.version)).toEqual([1, 2]);
    expect((await repository.listTasks('plan-1')).map((entry) => entry.id)).toEqual(['t1']);
  });

  it('persists and lists approval requests', async () => {
    const db = fakeDb();
    const repository = new PrismaDecisionRepository(db.client as never);
    const request = ApprovalRequestModel.create({
      planId: 'plan-1',
      decisionId: 'decision-1',
      storeId: STORE_ID,
      policy: 'REQUIRE_APPROVAL',
      reason: 'reason',
      requestedBy: 'alice',
      now: fixedClock,
    });
    await repository.saveApprovalRequest(request);
    expect((await repository.listApprovalRequests(STORE_ID)).map((entry) => entry.id)).toEqual([
      request.id,
    ]);
  });

  it('saves execution results onto tasks and lists them', async () => {
    const db = fakeDb();
    const repository = new PrismaDecisionRepository(db.client as never);
    const plan = makePlan('decision-1');
    await repository.savePlan(plan);
    const result = {
      id: 'result-1',
      taskId: 't1',
      planId: 'plan-1',
      storeId: STORE_ID,
      status: 'SUCCESS' as const,
      durationMs: 5,
      message: 'ok',
      apiResponses: [],
      startedAt: fixedClock(),
      completedAt: fixedClock(),
    };
    await repository.saveExecutionResult(result);
    expect((await repository.listExecutionResults('plan-1')).map((entry) => entry.id)).toEqual([
      'result-1',
    ]);
    const read = await repository.getPlan('plan-1');
    expect(read?.tasks[0]?.result?.status).toBe('SUCCESS');
  });

  it('persists and lists rollback records', async () => {
    const db = fakeDb();
    const repository = new PrismaDecisionRepository(db.client as never);
    const record = RollbackRecordModel.create({
      planId: 'plan-1',
      taskId: 't1',
      storeId: STORE_ID,
      rollback: {
        taskId: 't1',
        storeId: STORE_ID,
        planId: 'plan-1',
        actionType: 'update_title',
        resourceType: 'page',
        resourceId: `${ORIGIN}/p/1`,
        available: true,
        reason: 'reason',
        steps: [],
      },
      reason: 'reason',
      now: fixedClock,
    });
    await repository.saveRollbackRecord(record);
    const listed = await repository.listRollbackRecords(STORE_ID);
    expect(listed.map((entry) => entry.id)).toEqual([record.id]);
    expect(listed[0]?.steps).toEqual([]);
  });

  it('reads plans and tasks with null JSON fields', async () => {
    const db = fakeDb();
    const repository = new PrismaDecisionRepository(db.client as never);
    db.store.executionPlan.set('plan-null', {
      id: 'plan-null',
      storeId: STORE_ID,
      decisionId: 'decision-1',
      status: 'DRAFT',
      version: 1,
      batches: null,
      orderedTaskIds: ['t-null'],
      dependencies: [],
      approvalRequestId: null,
      estimatedDurationMinutes: 1,
      totalEffortHours: 0,
      totalImpact: 0,
      risk: 'LOW',
      createdAt: fixedClock(),
      updatedAt: fixedClock(),
    });
    db.store.executionTask.set('t-null', {
      id: 't-null',
      storeId: STORE_ID,
      decisionId: 'decision-1',
      planId: 'plan-null',
      recommendationId: 'rec-1',
      rule: 'missing-title',
      actionType: 'update_title',
      resourceType: 'page',
      resourceId: `${ORIGIN}/p/1`,
      resourceRef: `${ORIGIN}/p/1`,
      payload: {},
      priority: 50,
      status: 'PENDING',
      dependsOn: [],
      isMutating: true,
      risk: 'LOW',
      estimatedSeconds: 60,
      rollback: null,
      result: null,
      createdAt: fixedClock(),
      updatedAt: fixedClock(),
    });

    const read = await repository.getPlan('plan-null');
    expect(read?.batches).toEqual([]);
    expect(read?.tasks[0]?.rollback).toBeNull();
    expect(read?.tasks[0]?.result).toBeNull();
    expect(await repository.listExecutionResults('plan-null')).toEqual([]);
  });
});

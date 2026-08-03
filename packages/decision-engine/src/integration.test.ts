import { ConflictError } from '@seogod/core';
import { describe, expect, it } from 'vitest';
import {
  decisionInput,
  fixedClock,
  graphContext,
  ORIGIN,
  recommendation,
  STORE_ID,
} from './test/fixtures.js';
import { InMemoryDecisionRepository } from './test/memory-repository.js';
import { taskIdFor } from './planner/planner.js';
import { DecisionEngineService } from './services/decision-engine-service.js';
import type { ExecutionResult } from './types/result.js';
import type { ExecutionPlan } from './types/plan.js';

class FakeExecutor {
  readonly executed: Array<{ id: string; actionType: string; resourceRef: string }> = [];
  async executeTask(entry: ExecutionPlan['tasks'][number]): Promise<ExecutionResult> {
    this.executed.push({ id: entry.id, actionType: entry.actionType, resourceRef: entry.resourceRef });
    return {
      id: `result-${entry.id}`,
      taskId: entry.id,
      planId: entry.planId,
      storeId: entry.storeId,
      status: 'SUCCESS',
      durationMs: 3,
      message: 'ok',
      apiResponses: [],
      startedAt: fixedClock(),
      completedAt: fixedClock(),
    };
  }
  async rollbackTask(): Promise<void> {
    return undefined;
  }
  async executeRollback() {
    return { status: 'COMPLETED' as const, completedAt: fixedClock() };
  }
}

describe('decision engine integration', () => {
  it('runs a full create -> plan -> approve -> execute -> rollback pipeline', async () => {
    const repository = new InMemoryDecisionRepository();
    const service = new DecisionEngineService({ repository });
    const beforeValues: Record<string, Record<string, unknown>> = {};

    const input = decisionInput({
      recommendations: [
        recommendation({ id: 'rec-a', affectedUrls: [`${ORIGIN}/p/a`] }),
        recommendation({
          id: 'rec-b',
          rule: 'missing-meta-description',
          category: 'content',
          affectedUrls: [`${ORIGIN}/p/b`],
        }),
      ],
      graph: graphContext(),
    });

    const created = await service.createDecision(input);
    beforeValues[taskIdFor(created.decision.id, 'rec-a', `${ORIGIN}/p/a`)] = { title: 'Old title' };
    beforeValues[taskIdFor(created.decision.id, 'rec-b', `${ORIGIN}/p/b`)] = {
      metaDescription: 'Old meta description',
    };
    expect(created.decision.status).toBe('PENDING');
    expect(created.decision.summary.recommendationCount).toBe(2);

    const planned = await service.planDecision(created.decision.id, { beforeValues });
    expect(planned.decision.status).toBe('AWAITING_APPROVAL');
    expect(planned.plan.status).toBe('AWAITING_APPROVAL');
    expect(planned.plan.tasks.length).toBeGreaterThan(0);
    expect(planned.approvalRequest.status).toBe('PENDING');

    const approved = await service.approvePlan(planned.plan.id, 'alice');
    expect(approved.plan.status).toBe('APPROVED');
    expect((await service.getDecision(created.decision.id)).status).toBe('APPROVED');

    const executor = new FakeExecutor();
    const executed = await service.executePlan(planned.plan.id, executor);
    expect(executed.plan.status).toBe('COMPLETED');
    expect(executor.executed).toHaveLength(executed.plan.tasks.length);
    expect((await service.getDecision(created.decision.id)).status).toBe('COMPLETED');

    const rolledBack = await service.executeRollback(
      planned.plan.id,
      { reason: 'integration test' },
      executor,
    );
    expect(rolledBack.plan.status).toBe('ROLLED_BACK');
    expect(rolledBack.records.length).toBeGreaterThan(0);
    expect(rolledBack.records.every((record) => record.status === 'COMPLETED')).toBe(true);
    expect((await service.getDecision(created.decision.id)).status).toBe('ROLLED_BACK');

    const storedPlan = await repository.getPlan(planned.plan.id);
    expect(storedPlan?.status).toBe('ROLLED_BACK');
    expect(await repository.listRollbackRecords(STORE_ID)).toHaveLength(rolledBack.records.length);
  });

  it('blocks execution of a high-risk plan that was denied', async () => {
    const repository = new InMemoryDecisionRepository();
    const service = new DecisionEngineService({ repository });
    const input = decisionInput({
      storeSettings: { storeId: STORE_ID, approvalMode: 'review', riskTolerance: 'balanced', maxBatchSize: 50, maxChangesPerResource: 3, planCapRecommendations: null },
      recommendations: [
        recommendation({
          id: 'rec-del',
          rule: 'remove-duplicate-content',
          recommendedAction: 'Delete the duplicate page',
          affectedUrls: [`${ORIGIN}/p/dup`],
        }),
      ],
    });

    const created = await service.createDecision(input);
    const planned = await service.planDecision(created.decision.id);
    expect(planned.approvalRequest.status).toBe('REJECTED');

    await expect(service.executePlan(planned.plan.id, new FakeExecutor())).rejects.toThrow(
      ConflictError,
    );
    expect((await service.getDecision(created.decision.id)).status).toBe('REJECTED');
  });

  it('re-plans a decision to a newer version and executes the latest plan', async () => {
    const repository = new InMemoryDecisionRepository();
    const service = new DecisionEngineService({ repository });
    const created = await service.createDecision(decisionInput());

    const first = await service.planDecision(created.decision.id);
    await service.planDecision(created.decision.id);
    const latest = await repository.getPlanByDecision(created.decision.id);

    expect(latest?.id).toBeDefined();
    expect(latest?.id).not.toBe(first.plan.id);
    expect(latest?.version).toBeGreaterThan(first.plan.version);
    expect((await service.getDecision(created.decision.id)).planId).toBe(latest?.id);
  });
});

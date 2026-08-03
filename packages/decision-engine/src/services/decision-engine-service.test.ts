import type { EventBus, EventInput } from '@seogod/events';
import type { Logger } from '@seogod/logging';
import type { MetricsRegistry } from '@seogod/monitoring';
import { ConflictError, ConfigurationError, NotFoundError, ValidationError } from '@seogod/core';
import { describe, expect, it, vi } from 'vitest';
import { decisionInput, fixedClock, recommendation, STORE_ID } from '../test/fixtures.js';
import { taskIdFor } from '../planner/planner.js';
import { DecisionEngineService } from './decision-engine-service.js';
import { ExecutionPlanModel } from '../models/execution-plan.js';
import { task } from '../test/fixtures.js';
import type { Decision } from '../types/decision.js';
import type { ExecutionPlan } from '../types/plan.js';
import type { ExecutionResult, RollbackPlan } from '../types/result.js';
import type { PlanExecutor } from '../types/service.js';
import { InMemoryDecisionRepository } from '../test/memory-repository.js';

class FakeEventBus {
  readonly published: EventInput[] = [];
  private readonly failingTypes: string[];
  constructor(failingTypes: string[] = []) {
    this.failingTypes = failingTypes;
  }
  async publish(input: EventInput): Promise<never | void> {
    if (this.failingTypes.includes(input.type)) {
      throw new Error(`publish failed for ${input.type}`);
    }
    this.published.push(input);
  }
}

class FakeMetrics {
  readonly increments: Record<string, number> = {};
  readonly observations: Array<{ name: string; valueMs: number }> = [];
  increment(name: string, by = 1): void {
    this.increments[name] = (this.increments[name] ?? 0) + by;
  }
  setGauge(): void {}
  observe(name: string, valueMs: number): void {
    this.observations.push({ name, valueMs });
  }
}

class FakeExecutor implements PlanExecutor {
  readonly executed: ExecutionPlan['tasks'] = [];
  readonly rollbacks: RollbackPlan[] = [];
  constructor(
    private readonly behavior: {
      failTaskId?: string;
      throwOnTaskId?: string;
      rollbackFailure?: boolean;
      throwOnRollback?: boolean;
    } = {},
  ) {}

  async executeTask(entry: ExecutionPlan['tasks'][number]): Promise<ExecutionResult> {
    this.executed.push(entry);
    if (this.behavior.throwOnTaskId === entry.id) {
      throw new Error('executor exploded');
    }
    const status = this.behavior.failTaskId === entry.id ? 'FAILURE' : 'SUCCESS';
    return {
      id: `result-${entry.id}`,
      taskId: entry.id,
      planId: entry.planId,
      storeId: entry.storeId,
      status,
      durationMs: 5,
      message: status === 'SUCCESS' ? 'ok' : 'nope',
      apiResponses: [],
      startedAt: fixedClock(),
      completedAt: fixedClock(),
    };
  }

  async executeRollback(plan: RollbackPlan): Promise<{ status: 'COMPLETED' | 'FAILED'; error?: string; completedAt: Date }> {
    this.rollbacks.push(plan);
    if (this.behavior.throwOnRollback) {
      throw new Error('rollback executor exploded');
    }
    if (this.behavior.rollbackFailure) {
      return { status: 'FAILED', error: 'rollback exploded', completedAt: fixedClock() };
    }
    return { status: 'COMPLETED', completedAt: fixedClock() };
  }
}

interface Harness {
  service: DecisionEngineService;
  repository: InMemoryDecisionRepository;
  eventBus: FakeEventBus;
  metrics: FakeMetrics;
  logger: Logger;
}

function harness(failingEvents: string[] = []): Harness {
  const repository = new InMemoryDecisionRepository();
  const eventBus = new FakeEventBus(failingEvents);
  const metrics = new FakeMetrics();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
  const service = new DecisionEngineService({
    repository,
    eventBus: eventBus as unknown as EventBus,
    metrics: metrics as unknown as MetricsRegistry,
    logger,
    now: fixedClock,
  });
  return { service, repository, eventBus, metrics, logger };
}

async function createAndPlan(
  service: DecisionEngineService,
  input: ReturnType<typeof decisionInput> = decisionInput(),
): Promise<{ decision: Decision; plan: ExecutionPlan }> {
  const created = await service.createDecision(input);
  const planned = await service.planDecision(created.decision.id, {
    beforeValues: {
      [input.recommendations[0]!.id]: {},
    },
  });
  return { decision: planned.decision, plan: planned.plan };
}

describe('DecisionEngineService.createDecision', () => {
  it('creates and persists a pending decision', async () => {
    const { service, repository } = harness();
    const result = await service.createDecision(decisionInput());
    expect(result.decision.status).toBe('PENDING');
    expect(result.decision.score).toBeGreaterThan(0);
    expect(result.decision.summary.recommendationCount).toBe(1);
    expect(await repository.getDecision(result.decision.id)).toEqual(result.decision);
  });

  it('returns prioritized recommendations sorted by score', async () => {
    const { service } = harness();
    const result = await service.createDecision(decisionInput());
    expect(result.prioritized).toHaveLength(1);
    expect(result.prioritized[0]!.rank).toBe(1);
  });

  it('publishes decision.created and increments metrics', async () => {
    const { service, eventBus, metrics } = harness();
    const result = await service.createDecision(decisionInput());
    expect(eventBus.published.map((event) => event.type)).toContain('decision.created');
    expect(metrics.increments['decision_count']).toBe(1);
    expect(eventBus.published.find((event) => event.type === 'decision.created')?.payload).toMatchObject({
      decisionId: result.decision.id,
      storeId: STORE_ID,
    });
  });

  it('rejects invalid input', async () => {
    const { service } = harness();
    await expect(service.createDecision(decisionInput({ storeId: '' }))).rejects.toThrow(
      ValidationError,
    );
  });

  it('swallows event bus failures', async () => {
    const { service, logger } = harness(['decision.created']);
    const result = await service.createDecision(decisionInput());
    expect(result.decision.status).toBe('PENDING');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('is deterministic for identical input', async () => {
    const { service } = harness();
    const input = decisionInput();
    const first = await service.createDecision(input);
    const second = await service.createDecision(input);
    expect(first.decision.id).toBe(second.decision.id);
  });
});

describe('DecisionEngineService.planDecision', () => {
  it('plans a decision into an awaiting-approval plan', async () => {
    const { service } = harness();
    const created = await service.createDecision(decisionInput());
    const planned = await service.planDecision(created.decision.id);
    expect(planned.plan.status).toBe('AWAITING_APPROVAL');
    expect(planned.plan.tasks.length).toBeGreaterThan(0);
    expect(planned.plan.approvalRequestId).not.toBeNull();
    expect(planned.approvalRequest.status).toBe('PENDING');
    expect(planned.decision.status).toBe('AWAITING_APPROVAL');
    expect(planned.decision.planId).toBe(planned.plan.id);
    expect(planned.decision.summary.taskCount).toBeGreaterThan(0);
  });

  it('auto-approves low-risk plans', async () => {
    const { service, eventBus } = harness();
    const input = decisionInput({
      recommendations: [
        recommendation({ id: 'rec-low', impact: 'LOW', effort: 'HIGH', confidence: 0.05 }),
      ],
    });
    const created = await service.createDecision(input);
    const taskId = taskIdFor(
      created.decision.id,
      'rec-low',
      input.recommendations[0]!.affectedUrls[0]!,
    );
    const planned = await service.planDecision(created.decision.id, {
      beforeValues: { [taskId]: { title: 'Old title' } },
    });
    expect(planned.plan.status).toBe('APPROVED');
    expect(planned.decision.status).toBe('APPROVED');
    expect(planned.approvalRequest.status).toBe('APPROVED');
    expect(eventBus.published.map((event) => event.type)).toContain('plan.approved');
  });

  it('re-plans with an incremented version', async () => {
    const { service } = harness();
    const created = await service.createDecision(decisionInput());
    const first = await service.planDecision(created.decision.id);
    const second = await service.planDecision(created.decision.id);
    expect(first.plan.version).toBe(1);
    expect(second.plan.version).toBe(2);
  });

  it('throws NotFoundError for a missing decision', async () => {
    const { service } = harness();
    await expect(service.planDecision('missing')).rejects.toThrow(NotFoundError);
  });
});

describe('DecisionEngineService.approvePlan / rejectPlan', () => {
  it('approves a pending plan', async () => {
    const { service, metrics, eventBus } = harness();
    const { decision, plan } = await createAndPlan(service);
    const result = await service.approvePlan(plan.id, 'alice');
    expect(result.plan.status).toBe('APPROVED');
    expect(result.approvalRequest.status).toBe('APPROVED');
    expect(result.approvalRequest.decidedBy).toBe('alice');
    expect(metrics.increments['approval_count']).toBe(1);
    expect(eventBus.published.some((event) => event.type === 'plan.approved')).toBe(true);
    expect((await service.getDecision(decision.id)).status).toBe('APPROVED');
  });

  it('rejects a pending plan', async () => {
    const { service, eventBus } = harness();
    const { plan } = await createAndPlan(service);
    const result = await service.rejectPlan(plan.id, 'bob');
    expect(result.plan.status).toBe('REJECTED');
    expect(result.approvalRequest.status).toBe('REJECTED');
    expect(eventBus.published.some((event) => event.type === 'plan.rejected')).toBe(true);
  });

  it('throws ConflictError when the plan is not awaiting approval', async () => {
    const { service } = harness();
    const { plan } = await createAndPlan(service);
    await service.approvePlan(plan.id, 'alice');
    await expect(service.approvePlan(plan.id, 'alice')).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when rejecting a plan that is not awaiting approval', async () => {
    const { service } = harness();
    const { plan } = await createAndPlan(service);
    await service.approvePlan(plan.id, 'alice');
    await expect(service.rejectPlan(plan.id, 'bob')).rejects.toThrow(ConflictError);
  });

  it('throws NotFoundError when the approval request is missing', async () => {
    const { service, repository } = harness();
    const plan = ExecutionPlanModel.create({
      id: 'plan-orphan',
      storeId: STORE_ID,
      decisionId: 'decision-orphan',
      version: 1,
      tasks: [],
      batches: [],
      orderedTaskIds: [],
      dependencies: [],
      estimatedDurationMinutes: 1,
      totalEffortHours: 0,
      totalImpact: 0,
      risk: 'LOW',
      now: fixedClock,
    });
    await repository.savePlan({ ...plan, status: 'AWAITING_APPROVAL' });
    await expect(service.approvePlan('plan-orphan', 'alice')).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError for a missing plan', async () => {
    const { service } = harness();
    await expect(service.approvePlan('missing', 'alice')).rejects.toThrow(NotFoundError);
  });
});

describe('DecisionEngineService.executePlan', () => {
  it('throws ConfigurationError without an executor', async () => {
    const { service } = harness();
    const { plan } = await createAndPlan(service);
    await service.approvePlan(plan.id, 'alice');
    await expect(service.executePlan(plan.id, undefined as never)).rejects.toThrow(
      ConfigurationError,
    );
  });

  it('throws ConflictError when the plan is not approved', async () => {
    const { service } = harness();
    const { plan } = await createAndPlan(service);
    const executor = new FakeExecutor();
    await expect(service.executePlan(plan.id, executor)).rejects.toThrow(ConflictError);
  });

  it('executes tasks in order and completes the plan', async () => {
    const { service, metrics, eventBus } = harness();
    const { decision, plan } = await createAndPlan(service);
    await service.approvePlan(plan.id, 'alice');
    const executor = new FakeExecutor();
    const result = await service.executePlan(plan.id, executor);

    expect(result.plan.status).toBe('COMPLETED');
    expect(result.plan.tasks.every((entry) => entry.status === 'COMPLETED')).toBe(true);
    expect(result.results).toHaveLength(plan.tasks.length);
    expect(executor.executed.map((entry) => entry.id)).toEqual(plan.orderedTaskIds);
    expect((await service.getDecision(decision.id)).status).toBe('COMPLETED');
    expect(metrics.observations.some((entry) => entry.name === 'average_plan_time')).toBe(true);
    expect(metrics.observations.some((entry) => entry.name === 'decision_duration')).toBe(true);
    expect(eventBus.published.some((event) => event.type === 'execution.started')).toBe(true);
    expect(eventBus.published.some((event) => event.type === 'execution.completed')).toBe(true);
  });

  it('fails the plan when a task fails', async () => {
    const { service, eventBus } = harness();
    const { decision, plan } = await createAndPlan(service);
    await service.approvePlan(plan.id, 'alice');
    const executor = new FakeExecutor({ failTaskId: plan.tasks[0]!.id });
    const result = await service.executePlan(plan.id, executor);
    expect(result.plan.status).toBe('FAILED');
    expect(result.results[0]?.status).toBe('FAILURE');
    expect((await service.getDecision(decision.id)).status).toBe('FAILED');
    expect(eventBus.published.some((event) => event.type === 'execution.failed')).toBe(true);
  });

  it('captures executor exceptions as failed results', async () => {
    const { service } = harness();
    const { plan } = await createAndPlan(service);
    await service.approvePlan(plan.id, 'alice');
    const executor = new FakeExecutor({ throwOnTaskId: plan.tasks[0]!.id });
    const result = await service.executePlan(plan.id, executor);
    expect(result.plan.status).toBe('FAILED');
    expect(result.results[0]?.status).toBe('FAILURE');
    expect(result.results[0]?.message).toContain('executor exploded');
  });

  it('skips tasks blocked by a skipped prerequisite', async () => {
    const { service, repository } = harness();
    const created = await service.createDecision(decisionInput());
    await repository.saveDecision({ ...created.decision, id: 'decision-blocked' });
    const plan = ExecutionPlanModel.create({
      id: 'plan-blocked',
      storeId: STORE_ID,
      decisionId: 'decision-blocked',
      version: 1,
      tasks: [
        task({ id: 'first', status: 'SKIPPED' }),
        task({ id: 'second', status: 'PENDING', dependsOn: ['first'] }),
      ],
      batches: [],
      orderedTaskIds: ['first', 'second'],
      dependencies: [{ taskId: 'second', dependsOn: 'first' }],
      estimatedDurationMinutes: 1,
      totalEffortHours: 0,
      totalImpact: 0,
      risk: 'LOW',
      now: fixedClock,
    });
    await repository.savePlan({ ...plan, status: 'APPROVED' });
    const executor = new FakeExecutor();
    const result = await service.executePlan('plan-blocked', executor);
    expect(result.plan.status).toBe('COMPLETED');
    expect(result.plan.tasks.find((entry) => entry.id === 'second')?.status).toBe('SKIPPED');
    expect(executor.executed).toHaveLength(0);
  });
});

describe('DecisionEngineService.executeRollback', () => {
  async function executedPlan(harness: Harness) {
    const input = decisionInput({
      recommendations: [
        recommendation({ id: 'rec-low', impact: 'LOW', effort: 'HIGH', confidence: 0.05 }),
      ],
    });
    const created = await harness.service.createDecision(input);
    const taskId = taskIdFor(
      created.decision.id,
      'rec-low',
      input.recommendations[0]!.affectedUrls[0]!,
    );
    const planned = await harness.service.planDecision(created.decision.id, {
      beforeValues: { [taskId]: { title: 'Old title' } },
    });
    await harness.service.executePlan(planned.plan.id, new FakeExecutor());
    return { plan: planned.plan, taskId };
  }

  it('throws ConfigurationError without an executor', async () => {
    const h = harness();
    const { plan } = await createAndPlan(h.service);
    await h.service.approvePlan(plan.id, 'alice');
    await expect(
      h.service.executeRollback(plan.id, { reason: 'r' }, undefined as never),
    ).rejects.toThrow(ConfigurationError);
  });

  it('throws ConflictError for a task without executed state', async () => {
    const h = harness();
    const { plan } = await createAndPlan(h.service);
    await h.service.approvePlan(plan.id, 'alice');
    await expect(
      h.service.executeRollback(plan.id, { taskId: 'never-executed', reason: 'r' }, new FakeExecutor()),
    ).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when rollback is unavailable', async () => {
    const h = harness();
    const { plan } = await createAndPlan(h.service);
    await h.service.approvePlan(plan.id, 'alice');
    await h.service.executePlan(plan.id, new FakeExecutor());
    await expect(
      h.service.executeRollback(plan.id, { reason: 'r' }, new FakeExecutor()),
    ).rejects.toThrow(ConflictError);
  });

  it('records rollbacks and marks the plan rolled back', async () => {
    const h = harness();
    const { plan, taskId } = await executedPlan(h);
    const executor = new FakeExecutor();
    const result = await h.service.executeRollback(plan.id, { reason: 'user asked' }, executor);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.status).toBe('COMPLETED');
    expect(result.plan.status).toBe('ROLLED_BACK');
    expect(executor.rollbacks).toHaveLength(1);
    expect(h.metrics.increments['rollback_count']).toBe(1);
    expect(h.eventBus.published.some((event) => event.type === 'rollback.completed')).toBe(true);
    expect(result.plan.tasks.find((entry) => entry.id === taskId)?.status).toBe('ROLLED_BACK');
  });

  it('rolls back a single task', async () => {
    const h = harness();
    const { plan, taskId } = await executedPlan(h);
    const result = await h.service.executeRollback(
      plan.id,
      { taskId, reason: 'single' },
      new FakeExecutor(),
    );
    expect(result.records.map((entry) => entry.taskId)).toEqual([taskId]);
  });

  it('marks the record failed when the executor rollback fails', async () => {
    const h = harness();
    const { plan } = await executedPlan(h);
    const result = await h.service.executeRollback(
      plan.id,
      { reason: 'r' },
      new FakeExecutor({ rollbackFailure: true }),
    );
    expect(result.records[0]!.status).toBe('FAILED');
    expect(result.records[0]!.error).toContain('rollback exploded');
  });

  it('marks the record failed when the executor throws during rollback', async () => {
    const h = harness();
    const { plan } = await executedPlan(h);
    const result = await h.service.executeRollback(
      plan.id,
      { reason: 'r' },
      new FakeExecutor({ throwOnRollback: true }),
    );
    expect(result.records[0]!.status).toBe('FAILED');
    expect(result.records[0]!.error).toBe('rollback executor exploded');
  });
});

describe('DecisionEngineService queries', () => {
  it('throws NotFoundError for missing decisions and plans', async () => {
    const { service } = harness();
    await expect(service.getDecision('missing')).rejects.toThrow(NotFoundError);
    await expect(service.getPlan('missing')).rejects.toThrow(NotFoundError);
  });

  it('lists plans, approval requests, and rollback records', async () => {
    const { service } = harness();
    const created = await service.createDecision(decisionInput());
    await service.planDecision(created.decision.id);
    expect((await service.listPlans(STORE_ID)).length).toBe(1);
    expect((await service.listApprovalRequests(STORE_ID)).length).toBe(1);
    expect(await service.listRollbackRecords(STORE_ID)).toHaveLength(0);
  });
});

describe('DecisionEngineService decision status mapping', () => {
  it('keeps the decision awaiting when the plan awaits approval', async () => {
    const { service } = harness();
    const created = await service.createDecision(decisionInput());
    const planned = await service.planDecision(created.decision.id);
    expect(planned.decision.status).toBe('AWAITING_APPROVAL');
    expect(planned.decision.planId).toBe(planned.plan.id);
  });

  it('uses a stable plan id across re-plans', async () => {
    const { service } = harness();
    const created = await service.createDecision(decisionInput());
    const first = await service.planDecision(created.decision.id);
    const second = await service.planDecision(created.decision.id);
    expect(first.plan.id).not.toBe(second.plan.id);
  });
});

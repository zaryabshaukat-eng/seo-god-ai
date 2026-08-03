import { ConfigurationError, ConflictError, NotFoundError } from '@seogod/core';
import { getPrismaClient } from '@seogod/database';
import type { EventBus, EventInput } from '@seogod/events';
import type { Logger } from '@seogod/logging';
import type { MetricsRegistry } from '@seogod/monitoring';
import { ApprovalEngine } from '../approval/approval-engine.js';
import { ConflictDetector } from '../conflict-detector/conflict-detector.js';
import { DecisionModel } from '../models/decision.js';
import { DecisionSummaryModel } from '../models/decision-summary.js';
import { ExecutionPlanModel } from '../models/execution-plan.js';
import { planRolledBack, RollbackRecordModel } from '../models/rollback-record.js';
import { ExecutionPlanner, planIdForDecision } from '../planner/planner.js';
import { Prioritizer } from '../prioritizer/prioritizer.js';
import { PrismaDecisionRepository, type DecisionRepository } from '../repositories/decision-repository.js';
import { SafetyEngine } from '../safety/safety-engine.js';
import type {
  ApprovalResult,
  DecisionEngineResult,
  ExecutionPlanResult,
  PlanResult,
  RollbackResult,
} from '../types/service.js';
import type { PlanExecutor } from '../types/service.js';
import type { Decision, DecisionStatus } from '../types/decision.js';
import type { DecisionEngineInput } from '../types/input.js';
import type { ExecutionPlan, ExecutionTask } from '../types/plan.js';
import type { ExecutionResult, RollbackRecord } from '../types/result.js';
import type { ApprovalRequest } from '../types/approval.js';
import { validateDecisionInput } from '../utils/validation.js';

export interface DecisionEngineServiceOptions {
  repository?: DecisionRepository;
  prioritizer?: Prioritizer;
  planner?: ExecutionPlanner;
  conflictDetector?: ConflictDetector;
  safetyEngine?: SafetyEngine;
  approvalEngine?: ApprovalEngine;
  eventBus?: EventBus;
  logger?: Logger;
  metrics?: MetricsRegistry;
  now?: () => Date;
}

export interface PlanDecisionOptions {
  /** Captured previous state per task id, enabling rollback plans. */
  beforeValues?: Record<string, Record<string, unknown>>;
}

export interface RollbackOptions {
  /** Roll back a single task; when omitted, all executed tasks are rolled back. */
  taskId?: string;
  reason: string;
}

function decisionStatusForPlan(status: ExecutionPlan['status']): DecisionStatus {
  switch (status) {
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'AWAITING_APPROVAL':
      return 'AWAITING_APPROVAL';
    default:
      return 'PLANNED';
  }
}

function failureResult(task: ExecutionTask, error: unknown, now: () => Date): ExecutionResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: `result-${task.id}`,
    taskId: task.id,
    planId: task.planId,
    storeId: task.storeId,
    status: 'FAILURE',
    durationMs: 0,
    message,
    apiResponses: [],
    startedAt: now(),
    completedAt: now(),
  };
}

/**
 * Public API for the decision engine: create decisions, plan them into
 * approved rollback-ready execution plans, execute them through an injected
 * executor, and record rollbacks. Persistence sits behind
 * {@link DecisionRepository} (Prisma/PostgreSQL by default); events, metrics,
 * and logging are optional and injectable.
 */
export class DecisionEngineService {
  private readonly repository: DecisionRepository;
  private readonly prioritizer: Prioritizer;
  private readonly planner: ExecutionPlanner;
  private readonly conflictDetector: ConflictDetector;
  private readonly safetyEngine: SafetyEngine;
  private readonly approvalEngine: ApprovalEngine;
  private readonly eventBus: EventBus | undefined;
  private readonly logger: Logger | undefined;
  private readonly metrics: MetricsRegistry | undefined;
  private readonly now: () => Date;

  constructor(options: DecisionEngineServiceOptions = {}) {
    this.repository = options.repository ?? new PrismaDecisionRepository(getPrismaClient());
    this.prioritizer = options.prioritizer ?? new Prioritizer();
    this.planner = options.planner ?? new ExecutionPlanner();
    this.conflictDetector = options.conflictDetector ?? new ConflictDetector();
    this.safetyEngine = options.safetyEngine ?? new SafetyEngine();
    this.approvalEngine = options.approvalEngine ?? new ApprovalEngine();
    this.eventBus = options.eventBus;
    this.logger = options.logger;
    this.metrics = options.metrics;
    this.now = options.now ?? (() => new Date());
  }

  async createDecision(input: DecisionEngineInput): Promise<DecisionEngineResult> {
    validateDecisionInput(input);
    const prioritized = this.prioritizer.prioritize(input);
    const decision = DecisionModel.create({
      input,
      prioritized,
      summary: DecisionSummaryModel.initial(input),
      now: this.now,
    });
    await this.repository.saveDecision(decision);
    this.metrics?.increment('decision_count');
    await this.publish({
      type: 'decision.created',
      aggregateType: 'store',
      aggregateId: input.storeId,
      payload: {
        decisionId: decision.id,
        storeId: input.storeId,
        source: decision.source,
        score: decision.score,
        recommendationCount: input.recommendations.length,
      },
    });
    this.logger?.info(
      {
        storeId: input.storeId,
        decisionId: decision.id,
        score: decision.score,
        recommendationCount: input.recommendations.length,
      },
      'decision created',
    );
    return { decision, prioritized };
  }

  async planDecision(
    decisionId: string,
    options: PlanDecisionOptions = {},
  ): Promise<PlanResult> {
    const decision = await this.getDecision(decisionId);
    const input = decisionInputFromDecision(decision);
    const prioritized = this.prioritizer.prioritize(input);

    const existing = await this.repository.getPlanByDecision(decision.id);
    const version = existing === null ? 1 : existing.version + 1;
    const planId = planIdForDecision(decision.id, version);

    const tasks = this.planner.createTasks({ decision, planId, prioritized, now: this.now });
    const conflicts = this.conflictDetector.detect(tasks, {
      latestSnapshotId: decision.context.graph?.snapshotId,
    });
    const assembled = this.planner.assemble({
      decision,
      planId,
      tasks,
      excludedTaskIds: new Set(conflicts.excludedTaskIds),
      beforeValues: options.beforeValues,
      maxChangesPerResource: decision.context.storeSettings.maxChangesPerResource,
      now: this.now,
    });
    const assessment = this.safetyEngine.assess(assembled.tasks, decision.context);
    const plan = ExecutionPlanModel.create({
      id: planId,
      storeId: decision.storeId,
      decisionId: decision.id,
      version,
      tasks: assembled.tasks,
      batches: assembled.batches,
      orderedTaskIds: assembled.orderedTaskIds,
      dependencies: assembled.dependencies,
      estimatedDurationMinutes: assembled.estimatedDurationMinutes,
      totalEffortHours: assembled.totalEffortHours,
      totalImpact: assembled.totalImpact,
      risk: assessment.risk,
      now: this.now,
    });
    const review = this.approvalEngine.review({
      plan,
      assessment,
      context: decision.context,
      now: this.now,
    });

    const reviewedPlan = ExecutionPlanModel.setApprovalRequestId(
      ExecutionPlanModel.setStatus(plan, review.planStatus, this.now),
      review.approvalRequest.id,
    );
    await this.repository.savePlan(reviewedPlan);
    await this.repository.saveApprovalRequest(review.approvalRequest);

    const summary = DecisionSummaryModel.forPlan(input, reviewedPlan);
    const updatedDecision = DecisionModel.setSummary(
      DecisionModel.setPlanId(
        DecisionModel.setStatus(decision, decisionStatusForPlan(reviewedPlan.status), this.now),
        reviewedPlan.id,
        this.now,
      ),
      summary,
      this.now,
    );
    await this.repository.saveDecision(updatedDecision);

    this.metrics?.increment('execution_plan_count');
    if (review.planStatus === 'APPROVED' || review.planStatus === 'REJECTED') {
      this.metrics?.increment('approval_count');
    }
    if (review.planStatus === 'APPROVED') {
      await this.publish({
        type: 'plan.approved',
        aggregateType: 'store',
        aggregateId: decision.storeId,
        payload: {
          planId: reviewedPlan.id,
          decisionId: decision.id,
          storeId: decision.storeId,
          version,
          taskCount: reviewedPlan.tasks.length,
        },
      });
    } else if (review.planStatus === 'REJECTED') {
      await this.publish({
        type: 'plan.rejected',
        aggregateType: 'store',
        aggregateId: decision.storeId,
        payload: {
          planId: reviewedPlan.id,
          decisionId: decision.id,
          storeId: decision.storeId,
          version,
        },
      });
    }
    this.logger?.info(
      {
        storeId: decision.storeId,
        decisionId: decision.id,
        planId: reviewedPlan.id,
        version,
        status: reviewedPlan.status,
        risk: reviewedPlan.risk,
        taskCount: reviewedPlan.tasks.length,
        batchCount: reviewedPlan.batches.length,
        estimatedDurationMinutes: reviewedPlan.estimatedDurationMinutes,
      },
      'execution plan created',
    );

    return {
      decision: updatedDecision,
      plan: reviewedPlan,
      approvalRequest: review.approvalRequest,
      conflicts,
      prioritized,
    };
  }

  async approvePlan(planId: string, decidedBy: string): Promise<ApprovalResult> {
    const plan = await this.getPlan(planId);
    if (plan.status !== 'AWAITING_APPROVAL') {
      throw new ConflictError(`Plan ${planId} is not awaiting approval (${plan.status})`, {
        module: 'decision-engine',
        operation: 'approvePlan',
      });
    }
    const request = await this.findApprovalRequest(plan.storeId, plan.id);
    const decided = this.approvalEngine.decide(request, 'APPROVED', decidedBy, this.now);
    const approvedPlan = ExecutionPlanModel.setStatus(plan, 'APPROVED', this.now);
    await this.repository.savePlan(approvedPlan);
    await this.repository.saveApprovalRequest(decided);
    await this.repository.saveDecision(
      DecisionModel.setStatus(
        await this.getDecision(plan.decisionId),
        'APPROVED',
        this.now,
      ),
    );
    this.metrics?.increment('approval_count');
    await this.publish({
      type: 'plan.approved',
      aggregateType: 'store',
      aggregateId: plan.storeId,
      payload: {
        planId: approvedPlan.id,
        decisionId: plan.decisionId,
        storeId: plan.storeId,
        version: approvedPlan.version,
        decidedBy,
      },
    });
    this.logger?.info({ planId, decidedBy }, 'execution plan approved');
    return { plan: approvedPlan, approvalRequest: decided };
  }

  async rejectPlan(planId: string, decidedBy: string): Promise<ApprovalResult> {
    const plan = await this.getPlan(planId);
    if (plan.status !== 'AWAITING_APPROVAL') {
      throw new ConflictError(`Plan ${planId} is not awaiting approval (${plan.status})`, {
        module: 'decision-engine',
        operation: 'rejectPlan',
      });
    }
    const request = await this.findApprovalRequest(plan.storeId, plan.id);
    const decided = this.approvalEngine.decide(request, 'REJECTED', decidedBy, this.now);
    const rejectedPlan = ExecutionPlanModel.setStatus(plan, 'REJECTED', this.now);
    await this.repository.savePlan(rejectedPlan);
    await this.repository.saveApprovalRequest(decided);
    await this.repository.saveDecision(
      DecisionModel.setStatus(
        await this.getDecision(plan.decisionId),
        'REJECTED',
        this.now,
      ),
    );
    this.metrics?.increment('approval_count');
    await this.publish({
      type: 'plan.rejected',
      aggregateType: 'store',
      aggregateId: plan.storeId,
      payload: {
        planId: rejectedPlan.id,
        decisionId: plan.decisionId,
        storeId: plan.storeId,
        version: rejectedPlan.version,
        decidedBy,
      },
    });
    this.logger?.info({ planId, decidedBy }, 'execution plan rejected');
    return { plan: rejectedPlan, approvalRequest: decided };
  }

  async executePlan(planId: string, executor: PlanExecutor): Promise<ExecutionPlanResult> {
    if (executor === undefined) {
      throw new ConfigurationError('a PlanExecutor is required to execute plans', {
        module: 'decision-engine',
        operation: 'executePlan',
      });
    }
    const plan = await this.getPlan(planId);
    if (plan.status !== 'APPROVED') {
      throw new ConflictError(`Plan ${planId} is not approved (${plan.status})`, {
        module: 'decision-engine',
        operation: 'executePlan',
      });
    }
    const decision = await this.getDecision(plan.decisionId);
    const startedAt = this.now().getTime();
    let running = ExecutionPlanModel.setStatus(plan, 'EXECUTING', this.now);
    running = ExecutionPlanModel.setBatchStatuses(running, 'IN_PROGRESS');
    await this.repository.savePlan(running);
    await this.publish({
      type: 'execution.started',
      aggregateType: 'store',
      aggregateId: plan.storeId,
      payload: {
        planId: plan.id,
        decisionId: plan.decisionId,
        storeId: plan.storeId,
        taskCount: plan.tasks.length,
        batchCount: plan.batches.length,
      },
    });

    const results: ExecutionResult[] = [];
    const statuses = new Map(plan.tasks.map((task) => [task.id, task.status]));

    for (const taskId of plan.orderedTaskIds) {
      const task = plan.tasks.find((entry) => entry.id === taskId);
      if (task === undefined) continue;
      if (task.status === 'COMPLETED' || task.status === 'SKIPPED') continue;
      const blocked = task.dependsOn.some(
        (dependency) =>
          statuses.get(dependency) === 'FAILED' || statuses.get(dependency) === 'SKIPPED',
      );
      if (blocked) {
        running = ExecutionPlanModel.setTaskStatus(running, task.id, 'SKIPPED', this.now);
        statuses.set(task.id, 'SKIPPED');
        continue;
      }
      running = ExecutionPlanModel.setTaskStatus(running, task.id, 'IN_PROGRESS', this.now);
      let result: ExecutionResult;
      try {
        result = await executor.executeTask(task);
      } catch (error) {
        result = failureResult(task, error, this.now);
      }
      results.push(result);
      running = ExecutionPlanModel.setTaskResult(running, task.id, result);
      running = ExecutionPlanModel.setTaskStatus(
        running,
        task.id,
        result.status === 'SUCCESS' ? 'COMPLETED' : 'FAILED',
        this.now,
      );
      statuses.set(task.id, result.status === 'SUCCESS' ? 'COMPLETED' : 'FAILED');
      await this.repository.saveExecutionResult(result);
      if (result.status !== 'SUCCESS') {
        running = ExecutionPlanModel.setBatchStatuses(running, 'FAILED');
        running = ExecutionPlanModel.setStatus(running, 'FAILED', this.now);
        await this.repository.savePlan(running);
        const decisionFailed = DecisionModel.setStatus(decision, 'FAILED', this.now);
        await this.repository.saveDecision(decisionFailed);
        await this.publish({
          type: 'execution.failed',
          aggregateType: 'store',
          aggregateId: plan.storeId,
          payload: {
            planId: plan.id,
            decisionId: plan.decisionId,
            storeId: plan.storeId,
            failedTaskId: task.id,
            message: result.message,
          },
        });
        this.logger?.error({ planId: plan.id, taskId: task.id, message: result.message }, 'plan execution failed');
        return { plan: running, results };
      }
    }

    const completed = ExecutionPlanModel.setBatchStatuses(running, 'COMPLETED');
    const finished = ExecutionPlanModel.setStatus(completed, 'COMPLETED', this.now);
    await this.repository.savePlan(finished);
    const decisionCompleted = DecisionModel.setStatus(decision, 'COMPLETED', this.now);
    await this.repository.saveDecision(decisionCompleted);

    const completedAt = this.now().getTime();
    this.metrics?.observe('average_plan_time', completedAt - startedAt);
    this.metrics?.observe('decision_duration', completedAt - decision.createdAt.getTime());
    await this.publish({
      type: 'execution.completed',
      aggregateType: 'store',
      aggregateId: plan.storeId,
      payload: {
        planId: plan.id,
        decisionId: plan.decisionId,
        storeId: plan.storeId,
        taskCount: results.length,
        succeededCount: results.filter((result) => result.status === 'SUCCESS').length,
        failedCount: results.filter((result) => result.status === 'FAILURE').length,
        durationMs: completedAt - startedAt,
      },
    });
    this.logger?.info(
      {
        planId: plan.id,
        taskCount: results.length,
        durationMs: completedAt - startedAt,
      },
      'plan execution completed',
    );
    return { plan: finished, results };
  }

  async executeRollback(
    planId: string,
    options: RollbackOptions,
    executor: PlanExecutor,
  ): Promise<RollbackResult> {
    if (executor === undefined) {
      throw new ConfigurationError('a PlanExecutor is required to execute rollbacks', {
        module: 'decision-engine',
        operation: 'executeRollback',
      });
    }
    const plan = await this.getPlan(planId);
    const decision = await this.getDecision(plan.decisionId);
    const targets = plan.tasks.filter(
      (task) =>
        (options.taskId === undefined || task.id === options.taskId) &&
        (task.status === 'COMPLETED' || task.status === 'FAILED' || task.status === 'IN_PROGRESS'),
    );
    if (options.taskId !== undefined && targets.length === 0) {
      throw new ConflictError(`Task ${options.taskId} has no executed state to roll back`, {
        module: 'decision-engine',
        operation: 'executeRollback',
      });
    }

    const records: RollbackRecord[] = [];
    let rolledBackPlan = plan;
    for (const task of targets) {
      if (task.rollback === null || !task.rollback.available) {
        throw new ConflictError(`Task ${task.id} has no available rollback plan`, {
          module: 'decision-engine',
          operation: 'executeRollback',
        });
      }
      let record = RollbackRecordModel.create({
        planId: plan.id,
        taskId: task.id,
        storeId: plan.storeId,
        rollback: task.rollback,
        reason: options.reason,
        now: this.now,
      });
      await this.repository.saveRollbackRecord(record);
      let outcome: Awaited<ReturnType<PlanExecutor['executeRollback']>>;
      try {
        outcome = await executor.executeRollback(task.rollback);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outcome = { status: 'FAILED', error: message, completedAt: this.now() };
      }
      record =
        outcome.status === 'COMPLETED'
          ? RollbackRecordModel.complete(record, outcome.completedAt)
          : RollbackRecordModel.fail(record, outcome.error ?? 'rollback failed', outcome.completedAt);
      await this.repository.saveRollbackRecord(record);
      records.push(record);
    }

    rolledBackPlan = planRolledBack(plan, options.taskId ?? null, this.now);
    await this.repository.savePlan(rolledBackPlan);
    await this.repository.saveDecision(
      DecisionModel.setStatus(decision, 'ROLLED_BACK', this.now),
    );
    this.metrics?.increment('rollback_count', records.length);
    await this.publish({
      type: 'rollback.completed',
      aggregateType: 'store',
      aggregateId: plan.storeId,
      payload: {
        planId: plan.id,
        decisionId: plan.decisionId,
        storeId: plan.storeId,
        taskIds: records.map((record) => record.taskId),
        recordIds: records.map((record) => record.id),
      },
    });
    this.logger?.info(
      { planId: plan.id, rolledBackTasks: records.length, reason: options.reason },
      'plan rolled back',
    );
    return { records, plan: rolledBackPlan };
  }

  async getDecision(id: string): Promise<Decision> {
    const decision = await this.repository.getDecision(id);
    if (decision === null) {
      throw new NotFoundError(`Decision ${id} not found`, {
        module: 'decision-engine',
        operation: 'getDecision',
      });
    }
    return decision;
  }

  async getPlan(id: string): Promise<ExecutionPlan> {
    const plan = await this.repository.getPlan(id);
    if (plan === null) {
      throw new NotFoundError(`Execution plan ${id} not found`, {
        module: 'decision-engine',
        operation: 'getPlan',
      });
    }
    return plan;
  }

  async listPlans(storeId: string): Promise<ExecutionPlan[]> {
    return this.repository.listPlans(storeId);
  }

  async listApprovalRequests(storeId: string): Promise<ApprovalRequest[]> {
    return this.repository.listApprovalRequests(storeId);
  }

  async listRollbackRecords(storeId: string): Promise<RollbackRecord[]> {
    return this.repository.listRollbackRecords(storeId);
  }

  private async findApprovalRequest(storeId: string, planId: string): Promise<ApprovalRequest> {
    const requests = await this.repository.listApprovalRequests(storeId);
    const request = requests.find((entry) => entry.planId === planId);
    if (request === undefined) {
      throw new NotFoundError(`No approval request found for plan ${planId}`, {
        module: 'decision-engine',
        operation: 'findApprovalRequest',
      });
    }
    return request;
  }

  private async publish(input: EventInput): Promise<void> {
    if (this.eventBus === undefined) return;
    try {
      await this.eventBus.publish(input);
    } catch (error) {
      this.logger?.warn({ err: error, event: input.type }, 'failed to publish decision-engine event');
    }
  }
}

function decisionInputFromDecision(decision: Decision): DecisionEngineInput {
  return {
    storeId: decision.storeId,
    source: decision.source,
    recommendations: decision.recommendations,
    storeSettings: decision.context.storeSettings,
    featureFlags: decision.context.featureFlags,
    historicalOutcomes: decision.context.historicalOutcomes,
    graph: decision.context.graph,
    requestedBy: decision.context.requestedBy,
  };
}

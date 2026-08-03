import { Prisma, type PrismaClient } from '@prisma/client';
import type { ApprovalRequest } from '../types/approval.js';
import type { Decision } from '../types/decision.js';
import type { ExecutionPlan, ExecutionTask } from '../types/plan.js';
import type { ExecutionResult, RollbackRecord } from '../types/result.js';

/** Persistence contract for all decision-engine records. */
export interface DecisionRepository {
  saveDecision(decision: Decision): Promise<Decision>;
  getDecision(id: string): Promise<Decision | null>;
  savePlan(plan: ExecutionPlan): Promise<ExecutionPlan>;
  getPlan(id: string): Promise<ExecutionPlan | null>;
  getPlanByDecision(decisionId: string): Promise<ExecutionPlan | null>;
  listPlans(storeId: string): Promise<ExecutionPlan[]>;
  listTasks(planId: string): Promise<ExecutionTask[]>;
  saveApprovalRequest(request: ApprovalRequest): Promise<ApprovalRequest>;
  listApprovalRequests(storeId: string): Promise<ApprovalRequest[]>;
  saveExecutionResult(result: ExecutionResult): Promise<ExecutionResult>;
  listExecutionResults(planId: string): Promise<ExecutionResult[]>;
  saveRollbackRecord(record: RollbackRecord): Promise<RollbackRecord>;
  listRollbackRecords(storeId: string): Promise<RollbackRecord[]>;
}

/** Serializes arbitrary JSON-safe domain data for a JSONB column. */
export function toStoredJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

type DecisionRow = Prisma.DecisionGetPayload<Record<string, never>>;
type PlanRow = Prisma.ExecutionPlanGetPayload<Record<string, never>>;
type TaskRow = Prisma.ExecutionTaskGetPayload<Record<string, never>>;
type ApprovalRow = Prisma.PlanApprovalRequestGetPayload<Record<string, never>>;
type RollbackRow = Prisma.RollbackRecordGetPayload<Record<string, never>>;

/**
 * Prisma/PostgreSQL implementation of {@link DecisionRepository}. JSONB
 * columns hold the JSON-safe domain payloads; timestamps live in their own
 * columns.
 */
export class PrismaDecisionRepository implements DecisionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveDecision(decision: Decision): Promise<Decision> {
    const data: Prisma.DecisionUncheckedCreateInput = {
      id: decision.id,
      storeId: decision.storeId,
      source: decision.source,
      status: decision.status,
      score: decision.score,
      recommendationIds: toStoredJson(decision.recommendationIds),
      recommendations: toStoredJson(decision.recommendations),
      context: toStoredJson(decision.context),
      summary: toStoredJson(decision.summary),
      planId: decision.planId,
      createdAt: decision.createdAt,
      updatedAt: decision.updatedAt,
    };
    await this.prisma.decision.upsert({
      where: { id: decision.id },
      create: data,
      update: data,
    });
    return decision;
  }

  async getDecision(id: string): Promise<Decision | null> {
    const row = await this.prisma.decision.findUnique({ where: { id } });
    return row === null ? null : decisionFromRow(row);
  }

  async savePlan(plan: ExecutionPlan): Promise<ExecutionPlan> {
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.ExecutionPlanUncheckedCreateInput = {
        id: plan.id,
        storeId: plan.storeId,
        decisionId: plan.decisionId,
        status: plan.status,
        version: plan.version,
        estimatedDurationMinutes: plan.estimatedDurationMinutes,
        totalEffortHours: plan.totalEffortHours,
        totalImpact: plan.totalImpact,
        risk: plan.risk,
        approvalRequestId: plan.approvalRequestId,
        orderedTaskIds: toStoredJson(plan.orderedTaskIds),
        dependencies: toStoredJson(plan.dependencies),
        batches: toStoredJson(plan.batches),
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      };
      await tx.executionPlan.upsert({ where: { id: plan.id }, create: data, update: data });
      for (const task of plan.tasks) {
        await tx.executionTask.upsert({
          where: { id: task.id },
          create: taskRowFromDomain(task),
          update: taskRowFromDomain(task),
        });
      }
    });
    return plan;
  }

  async getPlan(id: string): Promise<ExecutionPlan | null> {
    const row = await this.prisma.executionPlan.findUnique({ where: { id } });
    if (row === null) return null;
    const tasks = await this.listTasks(id);
    return planFromRow(row, tasks);
  }

  async getPlanByDecision(decisionId: string): Promise<ExecutionPlan | null> {
    const row = await this.prisma.executionPlan.findFirst({
      where: { decisionId },
      orderBy: { version: 'desc' },
    });
    if (row === null) return null;
    const tasks = await this.listTasks(row.id);
    return planFromRow(row, tasks);
  }

  async listPlans(storeId: string): Promise<ExecutionPlan[]> {
    const rows = await this.prisma.executionPlan.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
    });
    const plans: ExecutionPlan[] = [];
    for (const row of rows) {
      const tasks = await this.listTasks(row.id);
      plans.push(planFromRow(row, tasks));
    }
    return plans;
  }

  async listTasks(planId: string): Promise<ExecutionTask[]> {
    const rows = await this.prisma.executionTask.findMany({
      where: { planId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(taskFromRow);
  }

  async saveApprovalRequest(request: ApprovalRequest): Promise<ApprovalRequest> {
    const data: Prisma.PlanApprovalRequestUncheckedCreateInput = {
      id: request.id,
      storeId: request.storeId,
      planId: request.planId,
      decisionId: request.decisionId,
      policy: request.policy,
      status: request.status,
      reason: request.reason,
      requestedBy: request.requestedBy,
      decidedBy: request.decidedBy,
      decidedAt: request.decidedAt,
      createdAt: request.createdAt,
    };
    await this.prisma.planApprovalRequest.upsert({
      where: { id: request.id },
      create: data,
      update: data,
    });
    return request;
  }

  async listApprovalRequests(storeId: string): Promise<ApprovalRequest[]> {
    const rows = await this.prisma.planApprovalRequest.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(approvalFromRow);
  }

  async saveExecutionResult(result: ExecutionResult): Promise<ExecutionResult> {
    await this.prisma.executionTask.update({
      where: { id: result.taskId },
      data: { result: toStoredJson(result) },
    });
    return result;
  }

  async listExecutionResults(planId: string): Promise<ExecutionResult[]> {
    const rows = await this.prisma.executionTask.findMany({
      where: { planId },
      orderBy: { createdAt: 'asc' },
    });
    const results: ExecutionResult[] = [];
    for (const row of rows) {
      if (row.result !== null) {
        results.push(row.result as unknown as ExecutionResult);
      }
    }
    return results;
  }

  async saveRollbackRecord(record: RollbackRecord): Promise<RollbackRecord> {
    const data: Prisma.RollbackRecordUncheckedCreateInput = {
      id: record.id,
      storeId: record.storeId,
      planId: record.planId,
      taskId: record.taskId,
      status: record.status,
      steps: toStoredJson(record.steps),
      reason: record.reason,
      error: record.error,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      createdAt: record.createdAt,
    };
    await this.prisma.rollbackRecord.upsert({
      where: { id: record.id },
      create: data,
      update: data,
    });
    return record;
  }

  async listRollbackRecords(storeId: string): Promise<RollbackRecord[]> {
    const rows = await this.prisma.rollbackRecord.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(rollbackFromRow);
  }
}

function decisionFromRow(row: DecisionRow): Decision {
  return {
    id: row.id,
    storeId: row.storeId,
    source: row.source as Decision['source'],
    status: row.status as Decision['status'],
    score: row.score,
    recommendationIds: row.recommendationIds as unknown as string[],
    recommendations: row.recommendations as unknown as Decision['recommendations'],
    context: row.context as unknown as Decision['context'],
    summary: row.summary as unknown as Decision['summary'],
    planId: row.planId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function taskRowFromDomain(task: ExecutionTask): Prisma.ExecutionTaskUncheckedCreateInput {
  return {
    id: task.id,
    storeId: task.storeId,
    decisionId: task.decisionId,
    planId: task.planId,
    recommendationId: task.recommendationId,
    rule: task.rule,
    actionType: task.actionType,
    resourceType: task.resourceType,
    resourceId: task.resourceId,
    resourceRef: task.resourceRef,
    payload: toStoredJson(task.payload),
    priority: task.priority,
    status: task.status,
    dependsOn: toStoredJson(task.dependsOn),
    isMutating: task.isMutating,
    risk: task.risk,
    estimatedSeconds: task.estimatedSeconds,
    rollback: task.rollback === null ? Prisma.JsonNull : toStoredJson(task.rollback),
    result: task.result === null ? Prisma.JsonNull : toStoredJson(task.result),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function taskFromRow(row: TaskRow): ExecutionTask {
  return {
    id: row.id,
    storeId: row.storeId,
    decisionId: row.decisionId,
    planId: row.planId,
    recommendationId: row.recommendationId,
    rule: row.rule,
    actionType: row.actionType as ExecutionTask['actionType'],
    resourceType: row.resourceType as ExecutionTask['resourceType'],
    resourceId: row.resourceId,
    resourceRef: row.resourceRef,
    payload: row.payload as Record<string, unknown>,
    priority: row.priority,
    status: row.status as ExecutionTask['status'],
    dependsOn: row.dependsOn as string[],
    isMutating: row.isMutating,
    risk: row.risk as ExecutionTask['risk'],
    estimatedSeconds: row.estimatedSeconds,
    rollback: row.rollback === null ? null : (row.rollback as unknown as ExecutionTask['rollback']),
    result: row.result === null ? null : (row.result as unknown as ExecutionTask['result']),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function planFromRow(row: PlanRow, tasks: ExecutionTask[]): ExecutionPlan {
  return {
    id: row.id,
    storeId: row.storeId,
    decisionId: row.decisionId,
    status: row.status as ExecutionPlan['status'],
    version: row.version,
    tasks,
    batches: row.batches === null ? [] : (row.batches as unknown as ExecutionPlan['batches']),
    orderedTaskIds: row.orderedTaskIds as unknown as string[],
    dependencies: row.dependencies as unknown as ExecutionPlan['dependencies'],
    approvalRequestId: row.approvalRequestId,
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    totalEffortHours: row.totalEffortHours,
    totalImpact: row.totalImpact,
    risk: row.risk as ExecutionPlan['risk'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function approvalFromRow(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    storeId: row.storeId,
    planId: row.planId,
    decisionId: row.decisionId,
    policy: row.policy as ApprovalRequest['policy'],
    status: row.status as ApprovalRequest['status'],
    reason: row.reason,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}

function rollbackFromRow(row: RollbackRow): RollbackRecord {
  return {
    id: row.id,
    storeId: row.storeId,
    planId: row.planId,
    taskId: row.taskId,
    status: row.status as RollbackRecord['status'],
    steps: row.steps as unknown as RollbackRecord['steps'],
    reason: row.reason,
    error: row.error,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

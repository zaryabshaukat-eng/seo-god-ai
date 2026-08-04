import type { ExecutionTask, ExecutionPlan, RollbackPlan as DecisionRollbackPlan } from '@seogod/decision-engine';
import type { Execution, ExecutionStep } from '../types/execution.js';
import type { ApprovedActionInput, ExecutionPlanInput } from '../types/plan.js';
import type { OperationRegistry } from '../types/publisher.js';
import type { SafetyConfig } from '../types/safety.js';
import { DEFAULT_SAFETY_CONFIG } from '../safety/config.js';
import { buildExecution, buildStep } from '../models/execution.js';
import { RollbackPlanner } from '../rollback/planner.js';
import { newId } from '../utils/ids.js';
import { InvalidExecutionError } from '../utils/errors.js';
import { groupStepsIntoBatches } from './grouping.js';

interface PlannerTaskInput {
  taskId: string;
  planId?: string | null;
  decisionId?: string | null;
  recommendationId?: string | null;
  workflowId?: string | null;
  actionType: string;
  resourceType: string;
  resourceId: string;
  resourceRef?: string;
  payload: Record<string, unknown>;
  priority?: number;
  isMutating?: boolean;
  dependsOn?: string[];
  approved?: boolean;
  approvalRequestId?: string | null;
  rollback?: DecisionRollbackPlan | null;
}

export interface ExecutionPlannerOptions {
  registry: OperationRegistry;
  config?: SafetyConfig;
}

/** Topologically orders tasks by their `dependsOn` task-id edges (Kahn's algorithm). */
function topoOrderTasks(tasks: PlannerTaskInput[]): number[] {
  const indices = new Map<string, number>();
  tasks.forEach((task, index) => indices.set(task.taskId, index));

  const indegree = new Array<number>(tasks.length).fill(0);
  const dependents = new Array<number[]>(tasks.length);
  for (let index = 0; index < tasks.length; index += 1) dependents[index] = [];

  for (const [index, task] of tasks.entries()) {
    const dependencies = new Set<string>();
    for (const dependency of task.dependsOn ?? []) {
      const dependencyIndex = indices.get(dependency);
      if (dependencyIndex !== undefined && dependencyIndex !== index) {
        dependencies.add(dependency);
        indegree[index] = (indegree[index] ?? 0) + 1;
      }
    }
    for (const dependency of dependencies) {
      const dependencyIndex = indices.get(dependency);
      if (dependencyIndex !== undefined) {
        const bucket = dependents[dependencyIndex] ?? [];
        bucket.push(index);
        dependents[dependencyIndex] = bucket;
      }
    }
  }

  const queue: number[] = [];
  for (let index = 0; index < tasks.length; index += 1) {
    if ((indegree[index] ?? 0) === 0) queue.push(index);
  }

  const result: number[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    result.push(current);
    for (const dependent of dependents[current] ?? []) {
      indegree[dependent] = (indegree[dependent] ?? 0) - 1;
      if ((indegree[dependent] ?? 0) === 0) queue.push(dependent);
    }
  }
  if (result.length !== tasks.length) {
    throw new InvalidExecutionError('task dependency graph contains a cycle');
  }
  return result;
}

/** Normalizes either a decision-engine plan or approved actions into planner tasks. */
function normalizeTasks(
  input: ExecutionPlanInput,
): { tasks: PlannerTaskInput[]; source: 'plan' | 'actions'; planId: string | null } {
  if (input.plan !== undefined) {
    const plan: ExecutionPlan = input.plan;
    const tasks: PlannerTaskInput[] = plan.tasks.map((task: ExecutionTask) => ({
      taskId: task.id,
      planId: plan.id,
      decisionId: task.decisionId ?? input.decisionId ?? null,
      recommendationId: task.recommendationId ?? null,
      workflowId: input.workflowId ?? null,
      actionType: task.actionType,
      resourceType: task.resourceType,
      resourceId: task.resourceId,
      resourceRef: task.resourceRef,
      payload: task.payload,
      priority: task.priority,
      isMutating: task.isMutating,
      dependsOn: task.dependsOn,
      rollback: task.rollback,
    }));
    return { tasks, source: 'plan', planId: plan.id };
  }
  const tasks: PlannerTaskInput[] = (input.actions ?? []).map((action: ApprovedActionInput) => ({
    taskId: `${action.actionType}:${action.resourceType}:${action.resourceId}`,
    planId: input.planId ?? null,
    decisionId: input.decisionId ?? null,
    recommendationId: null,
    workflowId: input.workflowId ?? null,
    actionType: action.actionType,
    resourceType: action.resourceType,
    resourceId: action.resourceId,
    resourceRef: action.resourceRef,
    payload: action.payload,
    priority: action.priority,
    isMutating: undefined,
    dependsOn: action.dependsOn,
    approved: action.approval?.approved,
    approvalRequestId: action.approval?.requestId ?? null,
    rollback: null,
  }));
  return { tasks, source: 'actions', planId: input.planId ?? null };
}

/** Builds an Execution from approved inputs, assigning ids, order and rollback plans. */
export class ExecutionPlanner {
  private readonly registry: OperationRegistry;
  private readonly config: SafetyConfig;
  private readonly rollbackPlanner: RollbackPlanner;

  constructor(options: ExecutionPlannerOptions) {
    this.registry = options.registry;
    this.config = options.config ?? DEFAULT_SAFETY_CONFIG;
    this.rollbackPlanner = new RollbackPlanner();
  }

  plan(input: ExecutionPlanInput): Execution {
    const { tasks, source, planId } = normalizeTasks(input);
    if (tasks.length === 0) {
      throw new InvalidExecutionError('execution plan must contain at least one task');
    }

    const approvedIds = new Set(input.approval?.approvedIds ?? []);
    const requestIds = input.approval?.requestIds ?? {};
    const executionId = newId();

    const order = topoOrderTasks(tasks);
    const orderedTasks = order
      .map((index) => tasks[index])
      .filter((task): task is PlannerTaskInput => task !== undefined);

    const planned: ExecutionStep[] = [];
    const idByTask = new Map<string, string>();

    for (const [index, task] of orderedTasks.entries()) {
      const operation = this.registry.has(task.actionType, task.resourceType)
        ? this.registry.get(task.actionType, task.resourceType)
        : null;
      const mutating = operation?.mutating ?? task.isMutating ?? true;
      const requiresApproval = mutating && (this.config.requireApproval || this.config.approvalRequiredActions.includes(task.actionType));
      const approved = task.approved ?? approvedIds.has(task.taskId);
      const step = buildStep({
        executionId,
        batchId: '',
        storeId: input.storeId,
        actionType: task.actionType,
        resourceType: task.resourceType,
        resourceId: task.resourceId,
        resourceRef: task.resourceRef,
        payload: task.payload,
        order: index,
        taskId: task.taskId,
        workflowId: task.workflowId,
        planId: task.planId ?? planId,
        decisionId: task.decisionId,
        recommendationId: task.recommendationId,
        priority: task.priority,
        isMutating: mutating,
        requiresApproval,
        approved,
        approvalRequestId: task.approvalRequestId ?? requestIds[task.taskId] ?? null,
        maxAttempts: this.config.maxRetries + 1,
      });
      planned.push(step);
      idByTask.set(task.taskId, step.id);
    }

    for (const step of planned) {
      const task = tasks.find((candidate) => candidate.taskId === step.taskId);
      if (task === undefined) continue;
      step.dependsOn = (task.dependsOn ?? []).map((dependency) => idByTask.get(dependency) ?? dependency);
      step.rollbackPlan =
        source === 'actions' || task.rollback === undefined
          ? this.rollbackPlanner.planForStep(step)
          : this.rollbackPlanner.planFromDecision(task.rollback);
    }

    const batches = groupStepsIntoBatches(executionId, input.storeId, planned, this.config.maxBatchSize);
    return buildExecution({
      id: executionId,
      storeId: input.storeId,
      mode: input.mode,
      source,
      planId,
      workflowId: input.workflowId ?? null,
      decisionId: input.decisionId ?? null,
      steps: planned,
      batches,
    });
  }
}

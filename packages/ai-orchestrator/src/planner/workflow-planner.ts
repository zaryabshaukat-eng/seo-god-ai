import type { ExecutionPlan, ExecutionTask, TaskActionType } from '@seogod/decision-engine';
import type { AgentWorkflow, PlanWorkflowOptions } from '../types/planner.js';
import type { ValidationSchema } from '../types/validation.js';
import type { AgentWorkflowStep, WorkflowDefinition, WorkflowStep } from '../types/workflow.js';
import type { AgentRegistry } from '../registry/agent-registry.js';
import { deterministicUuid } from '../utils/ids.js';

export interface WorkflowPlannerOptions {
  registry: AgentRegistry;
  /** Override agent resolution (default: registry.resolve(actionType)). */
  resolveAgent?: (task: { actionType: TaskActionType; rule: string; resourceType: string }) => string;
  /** Default parallelism per batch (default: the batch size). */
  batchConcurrency?: number;
  /** Build the output schema for a task's agent step. */
  taskSchemaBuilder?: (task: ExecutionTask) => ValidationSchema | undefined;
}

/** Default output contract every agent task must satisfy. */
export function defaultTaskSchema(task: ExecutionTask): ValidationSchema {
  return {
    type: 'object',
    required: ['action', 'resourceId'],
    properties: {
      action: { type: 'string', enum: [task.actionType] },
      resourceId: { type: 'string', minLength: 1 },
      resourceRef: { type: 'string' },
      changes: { type: 'object' },
    },
    additionalProperties: false,
  };
}

function taskDescription(task: ExecutionTask): string {
  return [
    `Apply "${task.actionType}" to ${task.resourceType} ${task.resourceRef}`,
    `rule: ${task.rule}, priority: ${task.priority}, risk: ${task.risk}`,
    `payload: ${JSON.stringify(task.payload)}`,
  ].join('\n');
}

function agentStep(task: ExecutionTask, agentId: string, schema: ValidationSchema | undefined): AgentWorkflowStep {
  return {
    id: `step-${task.id}`,
    kind: 'agent',
    agentId,
    name: `${task.actionType}@${task.resourceRef}`,
    taskTemplate: taskDescription(task),
    schema,
    allowedActions: [task.actionType],
    timeoutMs: 60_000,
  };
}

/**
 * Converts a decision-engine {@link ExecutionPlan} into a deterministic
 * {@link AgentWorkflow}: one sequential list of parallel batches, matching
 * the plan's batching and ordering. No business logic — agents only
 * produce content for already-decided actions.
 */
export class WorkflowPlanner {
  private readonly registry: AgentRegistry;
  private readonly resolveAgent: (task: ExecutionTask) => string;
  private readonly batchConcurrency: number | undefined;
  private readonly taskSchemaBuilder: (task: ExecutionTask) => ValidationSchema | undefined;

  constructor(options: WorkflowPlannerOptions) {
    this.registry = options.registry;
    this.resolveAgent =
      options.resolveAgent !== undefined
        ? (task) => options.resolveAgent?.({ actionType: task.actionType, rule: task.rule, resourceType: task.resourceType }) ?? ''
        : (task) => this.registry.resolve(task.actionType).id;
    this.batchConcurrency = options.batchConcurrency;
    this.taskSchemaBuilder = options.taskSchemaBuilder ?? defaultTaskSchema;
  }

  plan(executionPlan: ExecutionPlan, options: PlanWorkflowOptions = {}): AgentWorkflow {
    const resolve = options.resolveAgent !== undefined
      ? (task: ExecutionTask) =>
          options.resolveAgent?.({ actionType: task.actionType, rule: task.rule, resourceType: task.resourceType }) ?? ''
      : this.resolveAgent;

    const tasksByBatch = new Map<string, ExecutionTask[]>();
    for (const batch of [...executionPlan.batches].sort((a, b) => a.order - b.order)) {
      const batchTasks = batch.taskIds
        .map((taskId) => executionPlan.tasks.find((task) => task.id === taskId))
        .filter((task): task is ExecutionTask => task !== undefined);
      tasksByBatch.set(batch.id, batchTasks);
    }

    const definitions: WorkflowDefinition = {
      id: deterministicUuid('workflow-definition', executionPlan.id),
      name: `plan-${executionPlan.id}`,
      description: `Execution of decision ${executionPlan.decisionId}`,
      version: executionPlan.version,
      timeoutMs: 0,
      defaultMaxAttempts: 1,
      steps: [],
    };

    const assignments: Record<string, string> = {};
    const steps: WorkflowStep[] = [];

    for (const [batchId, tasks] of tasksByBatch) {
      if (tasks.length === 0) continue;
      const concurrency = options.batchConcurrency ?? this.batchConcurrency ?? tasks.length;
      for (const task of tasks) {
        const stepId = `step-${task.id}`;
        const schema = this.taskSchemaBuilder(task);
        const agentId = resolve(task);
        assignments[stepId] = agentId;
        const step = agentStep(task, agentId, schema);
        const group = steps.at(-1);
        if (group !== undefined && group.kind === 'parallel' && group.id === `batch-${batchId}`) {
          group.steps.push(step);
        } else {
          steps.push({
            id: `batch-${batchId}`,
            kind: 'parallel',
            steps: [step],
            maxConcurrency: Math.max(1, concurrency),
          });
        }
      }
    }

    definitions.steps = steps;
    return {
      definition: definitions,
      assignments,
      source: {
        planId: executionPlan.id,
        decisionId: executionPlan.decisionId,
        storeId: executionPlan.storeId,
        taskCount: executionPlan.tasks.length,
      },
    };
  }
}

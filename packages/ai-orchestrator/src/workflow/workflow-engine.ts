import { ValidationError } from '@seogod/core';
import type { MetricsRegistry } from '@seogod/monitoring';
import type { Logger } from '@seogod/logging';
import type { AgentTask, AgentResult } from '../types/agent.js';
import type {
  AgentExecution,
  ExecutionReport,
  ExecutionTrace,
  StepExecution,
  WorkflowExecution,
} from '../types/execution.js';
import type { EventSink, OrchestratorEvent } from '../types/events.js';
import type { WorkflowDefinition, WorkflowStep } from '../types/workflow.js';
import type { AgentWorkflowStep } from '../types/workflow.js';
import { WorkflowExecutionModel } from '../models/workflow-execution.js';
import { ExecutionTraceModel } from '../models/execution-trace.js';
import { ExecutionReportModel } from '../models/execution-report.js';
import { CancelledError, OrchestratorError } from '../errors.js';
import { errorMessage } from '../utils/retry.js';
import { resolveOutputs } from '../utils/path.js';
import type { ExecutionEngine, AgentStepContext } from '../execution/execution-engine.js';

/** Builds an {@link AgentTask} (incl. prompt context) for an agent step. */
export interface AgentTaskFactory {
  build(step: AgentWorkflowStep, workflow: WorkflowExecution): Promise<AgentTask>;
}

export interface WorkflowEngineOptions {
  executionEngine: ExecutionEngine;
  taskFactory: AgentTaskFactory;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  eventSink?: EventSink;
  metrics?: MetricsRegistry;
  logger?: Logger;
  /** Called after every top-level step to persist progress. */
  onCheckpoint?: (execution: WorkflowExecution) => Promise<void> | void;
  defaultMaxAttempts?: number;
  defaultTimeoutMs?: number;
}

export interface RunWorkflowOptions {
  signal?: AbortSignal;
  storeId?: string;
  /** Overall workflow timeout in ms (overrides the definition). */
  timeoutMs?: number;
  /** Parallelism for parallel groups and the top level (default 1). */
  maxConcurrency?: number;
  /** Resume from a checkpointed execution (completed steps are skipped). */
  startFrom?: WorkflowExecution;
}

export interface WorkflowResult {
  execution: WorkflowExecution;
  report: ExecutionReport;
  trace: ExecutionTrace;
  agentExecutions: AgentExecution[];
}

interface RunContext {
  execution: WorkflowExecution;
  signal: AbortSignal;
  defaultMaxAttempts: number;
  defaultTimeoutMs: number;
  maxConcurrency: number;
  agentExecutions: AgentExecution[];
  traceEvent(type: string, data?: Record<string, unknown>): void;
  checkpoint(): Promise<void>;
}

/**
 * Executes {@link WorkflowDefinition}s with sequential, parallel, and
 * conditional step semantics, dependency-aware scheduling, per-step retry
 * and timeout, cancellation, checkpointing, and recovery. Business logic
 * never lives here: agents are black boxes behind the execution engine.
 */
export class WorkflowEngine {
  private readonly engine: ExecutionEngine;
  private readonly taskFactory: AgentTaskFactory;
  private readonly now: () => Date;
  private readonly eventSink: EventSink | undefined;
  private readonly metrics: MetricsRegistry | undefined;
  private readonly logger: Logger | undefined;
  private readonly onCheckpoint: ((execution: WorkflowExecution) => Promise<void> | void) | undefined;
  private readonly defaultMaxAttempts: number;
  private readonly defaultTimeoutMs: number;

  constructor(options: WorkflowEngineOptions) {
    this.engine = options.executionEngine;
    this.taskFactory = options.taskFactory;
    this.now = options.now ?? (() => new Date());
    this.eventSink = options.eventSink;
    this.metrics = options.metrics;
    this.logger = options.logger;
    this.onCheckpoint = options.onCheckpoint;
    this.defaultMaxAttempts = options.defaultMaxAttempts ?? 1;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 0;
  }

  run(definition: WorkflowDefinition, inputs: Record<string, unknown>, options: RunWorkflowOptions = {}): Promise<WorkflowResult> {
    return this.execute(definition, inputs, options);
  }

  private async execute(
    definition: WorkflowDefinition,
    inputs: Record<string, unknown>,
    options: RunWorkflowOptions,
  ): Promise<WorkflowResult> {
    validateDefinition(definition);
    const now = this.now;
    const storeId = options.startFrom?.storeId ?? options.storeId ?? (inputs.storeId as string | undefined) ?? '';

    const execution =
      options.startFrom ?? WorkflowExecutionModel.create({ definition, storeId, inputs, now });
    execution.status = 'RUNNING';
    let trace = ExecutionTraceModel.create(execution.id);
    const agentExecutions: AgentExecution[] = [];

    const timedOut = { value: false };
    const controller = new AbortController();
    const overallMs = options.timeoutMs ?? definition.timeoutMs ?? 0;
    const timer =
      overallMs > 0
        ? setTimeout(() => {
            timedOut.value = true;
            controller.abort();
          }, overallMs)
        : null;
    const externalSignal = options.signal;
    if (externalSignal !== undefined) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    const traceEvent = (type: string, data?: Record<string, unknown>): void => {
      trace = ExecutionTraceModel.append(
        trace,
        { executionId: execution.id, type, ...(data === undefined ? {} : { data }) },
        now,
      );
    };

    const ctx: RunContext = {
      execution,
      signal: controller.signal,
      defaultMaxAttempts: definition.defaultMaxAttempts ?? this.defaultMaxAttempts,
      defaultTimeoutMs: this.defaultTimeoutMs,
      maxConcurrency: options.maxConcurrency ?? 1,
      agentExecutions,
      traceEvent,
      checkpoint: async () => {
        execution.checkpointedAt = now();
        await this.onCheckpoint?.(execution);
      },
    };

    const startedAt = now().getTime();
    const totals = (): { totalTokens: number; costEstimate: number } =>
      agentExecutions.reduce(
        (acc, execution) => ({
          totalTokens: acc.totalTokens + execution.totalTokens,
          costEstimate: acc.costEstimate + execution.costEstimate,
        }),
        { totalTokens: 0, costEstimate: 0 },
      );
    traceEvent('workflow.started', { definitionId: definition.id, storeId });
    this.emitEvent({
      type: 'workflow.started',
      workflowId: execution.id,
      definitionId: definition.id,
      definitionVersion: definition.version,
      name: definition.name,
      storeId,
    });
    this.metrics?.increment('workflow_count');
    this.logger?.info(
      { workflowId: execution.id, definitionId: definition.id, storeId, status: 'running' },
      'workflow started',
    );

    try {
      await this.runSteps(definition.steps, ctx, 1);
      execution.status = 'COMPLETED';
      execution.completedAt = now();
      execution.error = null;
      traceEvent('workflow.completed', {});
      const durationMs = now().getTime() - startedAt;
      this.metrics?.observe('workflow_duration', durationMs);
      this.logger?.info(
        { workflowId: execution.id, storeId, status: 'completed', duration: durationMs },
        'workflow completed',
      );
      this.emitEvent({
        type: 'workflow.completed',
        workflowId: execution.id,
        name: definition.name,
        status: 'COMPLETED',
        storeId,
        durationMs,
        ...totals(),
      });
    } catch (error) {
      const durationMs = now().getTime() - startedAt;
      this.metrics?.observe('workflow_duration', durationMs);
      if (timedOut.value) {
        execution.status = 'TIMED_OUT';
        execution.error = `workflow exceeded its time budget (${overallMs}ms)`;
      } else if (controller.signal.aborted || error instanceof CancelledError) {
        execution.status = 'CANCELLED';
        execution.cancelledAt = now();
        execution.error = 'workflow was cancelled';
      } else {
        execution.status = 'FAILED';
        execution.error = errorMessage(error);
      }
      execution.completedAt = now();
      traceEvent('workflow.failed', { status: execution.status, error: execution.error });
      this.logger?.error(
        {
          workflowId: execution.id,
          storeId,
          status: execution.status,
          duration: durationMs,
          error: execution.error,
        },
        'workflow failed',
      );
      this.emitEvent({
        type: 'workflow.failed',
        workflowId: execution.id,
        name: definition.name,
        status: execution.status,
        storeId,
        durationMs,
        ...totals(),
      });
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (externalSignal !== undefined) {
        externalSignal.removeEventListener('abort', () => controller.abort());
      }
      await ctx.checkpoint();
    }

    const report = ExecutionReportModel.fromExecution(execution);
    return { execution, report, trace, agentExecutions };
  }

  /**
   * Executes a list of steps as a dependency graph: a step starts once every
   * id in its `dependsOn` has completed. Fails fast (remaining steps become
   * SKIPPED) so plans stay deterministic under partial failure.
   */
  private async runSteps(steps: WorkflowStep[], ctx: RunContext, concurrency: number): Promise<void> {
    if (steps.length === 0) return;
    const remaining = new Set(steps.map((step) => step.id));
    const done = new Set<string>();
    let firstError: unknown = null;

    while (remaining.size > 0) {
      if (ctx.signal.aborted) throw new CancelledError('workflow was cancelled');
      const ready = steps.filter(
        (step) =>
          remaining.has(step.id) &&
          (step.dependsOn === undefined || step.dependsOn.every((id) => done.has(id))),
      );
      if (ready.length === 0) {
        throw new OrchestratorError('step graph contains an unsatisfiable dependency cycle');
      }

      const effective = Math.max(1, Math.floor(concurrency));
      for (let i = 0; i < ready.length; i += effective) {
        const chunk = ready.slice(i, i + effective);
        const results = await Promise.allSettled(chunk.map((step) => this.runStep(step, ctx)));
        for (let j = 0; j < results.length; j += 1) {
          const step = chunk[j] as WorkflowStep;
          const result = results[j];
          remaining.delete(step.id);
          if (result !== undefined && result.status === 'fulfilled') {
            done.add(step.id);
          } else if (result !== undefined && result.status === 'rejected') {
            if (firstError === null) firstError = result.reason;
          }
        }
        if (firstError !== null) break;
      }
      if (firstError !== null) break;
    }

    for (const step of steps) {
      if (remaining.has(step.id)) {
        const record =
          ctx.execution.steps.find((s) => s.stepId === step.id) ??
          this.prepareStep(step, ctx.execution);
        record.status = 'SKIPPED';
        ctx.traceEvent('step.skipped', { stepId: step.id });
      }
    }
    if (firstError !== null) {
      throw firstError instanceof Error ? firstError : new OrchestratorError(String(firstError));
    }
  }

  private async runStep(step: WorkflowStep, ctx: RunContext): Promise<void> {
    const existing = ctx.execution.steps.find((s) => s.stepId === step.id);
    if (existing !== undefined && existing.status === 'COMPLETED') {
      ctx.traceEvent('step.resumed', { stepId: step.id });
      return;
    }
    const stepExecution: StepExecution =
      existing ?? this.prepareStep(step, ctx.execution);
    stepExecution.status = 'RUNNING';
    stepExecution.startedAt = this.now();
    ctx.traceEvent('step.started', { stepId: step.id, kind: step.kind });

    try {
      await this.runStepBody(step, ctx, stepExecution);
      stepExecution.status = 'COMPLETED';
      stepExecution.completedAt = this.now();
      ctx.traceEvent('step.completed', { stepId: step.id });
    } catch (error) {
      stepExecution.status = 'FAILED';
      stepExecution.completedAt = this.now();
      stepExecution.error = errorMessage(error);
      ctx.traceEvent('step.failed', { stepId: step.id, error: stepExecution.error });
      throw error;
    }
    await ctx.checkpoint();
  }

  private async runStepBody(step: WorkflowStep, ctx: RunContext, stepExecution: StepExecution): Promise<void> {
    switch (step.kind) {
      case 'agent': {
        const { result, executions } = await this.runAgent(step, ctx);
        ctx.agentExecutions.push(...executions);
        const last = executions.at(-1);
        if (last !== undefined) stepExecution.agentExecutionId = last.id;
        ctx.execution.outputs[step.id] = result;
        return;
      }
      case 'sequential':
        await this.runSteps(step.steps, ctx, 1);
        return;
      case 'parallel':
        await this.runSteps(step.steps, ctx, step.maxConcurrency ?? ctx.maxConcurrency);
        return;
      case 'conditional': {
        const result = this.evaluateCondition(step.condition, ctx.execution);
        stepExecution.branchTaken = result;
        ctx.traceEvent('step.conditional', { stepId: step.id, branch: result });
        await this.runSteps(result ? step.whenTrue : step.whenFalse, ctx, 1);
        return;
      }
    }
  }

  private async runAgent(
    step: AgentWorkflowStep,
    ctx: RunContext,
  ): Promise<{ result: AgentResult; executions: AgentExecution[] }> {
    const agentCtx: AgentStepContext = {
      workflowId: ctx.execution.id,
      storeId: ctx.execution.storeId,
      definition: {
        id: ctx.execution.definitionId,
        name: ctx.execution.name,
        version: ctx.execution.definitionVersion,
        steps: [],
      },
      inputs: ctx.execution.inputs,
      signal: ctx.signal,
      defaultMaxAttempts: ctx.defaultMaxAttempts,
      defaultTimeoutMs: ctx.defaultTimeoutMs,
      buildTask: async (agentStep) => this.taskFactory.build(agentStep, ctx.execution),
      trace: ctx.traceEvent,
    };
    return this.engine.executeAgentStep(step, agentCtx);
  }

  private prepareStep(step: WorkflowStep, execution: WorkflowExecution): StepExecution {
    const created = WorkflowExecutionModel.createStep({ step, now: this.now });
    execution.steps.push(created);
    return created;
  }

  private evaluateCondition(
    condition: WorkflowConditionLike,
    execution: WorkflowExecution,
  ): boolean {
    const value = resolveOutputs(
      execution.outputs as unknown as Record<string, unknown>,
      condition.key,
    );
    switch (condition.operator) {
      case 'eq':
        return value === condition.value;
      case 'ne':
        return value !== condition.value;
      case 'exists':
        return value !== undefined;
      case 'not_exists':
        return value === undefined;
      case 'gt':
        return typeof value === 'number' && value > (condition.value as number);
      case 'lt':
        return typeof value === 'number' && value < (condition.value as number);
      case 'contains':
        return typeof value === 'string' && value.includes(condition.value as string);
    }
  }

  private emitEvent(event: OrchestratorEvent): void {
    this.eventSink?.emit(event);
  }
}

interface WorkflowConditionLike {
  key: string;
  operator: 'eq' | 'ne' | 'exists' | 'not_exists' | 'gt' | 'lt' | 'contains';
  value?: unknown;
}

/** Validates a workflow definition before it runs. */
export function validateDefinition(definition: WorkflowDefinition): void {
  const problems: string[] = [];
  if (definition.id.trim() === '') problems.push('id is required');
  if (definition.name.trim() === '') problems.push('name is required');
  if (definition.version < 1) problems.push('version must be >= 1');
  if (!Array.isArray(definition.steps)) problems.push('steps must be an array');
  if (problems.length > 0) {
    throw new ValidationError(`Invalid workflow definition: ${problems.join(', ')}`, {
      module: 'ai-orchestrator',
      operation: 'workflow.validate',
    });
  }
  const ids = new Set<string>();
  const duplicates: string[] = [];
  collectStepIds(definition.steps, ids, duplicates);
  if (duplicates.length > 0) {
    throw new ValidationError(
      `Workflow step ids must be unique; duplicates: ${duplicates.join(', ')}`,
      { module: 'ai-orchestrator', operation: 'workflow.validate' },
    );
  }
}

function collectStepIds(
  steps: WorkflowStep[],
  ids: Set<string>,
  duplicates: string[],
): void {
  for (const step of steps) {
    if (ids.has(step.id)) duplicates.push(step.id);
    ids.add(step.id);
    switch (step.kind) {
      case 'sequential':
      case 'parallel':
        collectStepIds(step.steps, ids, duplicates);
        break;
      case 'conditional':
        collectStepIds(step.whenTrue, ids, duplicates);
        collectStepIds(step.whenFalse, ids, duplicates);
        break;
      case 'agent':
        break;
    }
  }
}

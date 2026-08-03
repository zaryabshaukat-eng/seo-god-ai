import { NotFoundError, ValidationError } from '@seogod/core';
import type { EventBus } from '@seogod/events';
import type { Logger } from '@seogod/logging';
import type { MetricsRegistry } from '@seogod/monitoring';
import type { ExecutionPlan } from '@seogod/decision-engine';
import type { AgentDefinition, AgentResult, AgentTask } from '../types/agent.js';
import type { PromptContext, ContextSources } from '../types/context.js';
import type { EventSink, OrchestratorEvent, ValidationFailedEvent } from '../types/events.js';
import type {
  ExecutionReport,
  ExecutionTrace,
  WorkflowExecution,
} from '../types/execution.js';
import type { MemoryEntry, MemoryQuery } from '../types/memory.js';
import type { AgentWorkflow, PlanWorkflowOptions } from '../types/planner.js';
import type { WorkflowDefinition } from '../types/workflow.js';
import type { ProviderFactory } from '../providers/provider-factory.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { ContextBuilder } from '../context/context-builder.js';
import type { PromptBuilder } from '../prompts/prompt-builder.js';
import type { ResponseValidator } from '../validation/response-validator.js';
import type { SafetyGuard } from '../safety/safety-guard.js';
import type { OrchestratorRepository } from '../types/repository.js';
import type { Scheduler } from '../scheduler/scheduler.js';
import type { AgentWorkflowStep } from '../types/workflow.js';
import { AgentRegistry } from '../registry/agent-registry.js';
import { AgentRunner, type AgentExecutor } from '../execution/agent-runner.js';
import { ExecutionEngine } from '../execution/execution-engine.js';
import {
  WorkflowEngine,
  type AgentTaskFactory,
  type WorkflowResult,
} from '../workflow/workflow-engine.js';
import { WorkflowPlanner } from '../planner/workflow-planner.js';
import { ContextBuilder as DefaultContextBuilder } from '../context/context-builder.js';
import { PromptBuilder as DefaultPromptBuilder } from '../prompts/prompt-builder.js';
import { ResponseValidator as DefaultResponseValidator } from '../validation/response-validator.js';
import { SafetyGuard as DefaultSafetyGuard } from '../safety/safety-guard.js';
import { InMemoryOrchestratorRepository } from '../repositories/in-memory-repository.js';
import { WorkflowExecutionModel } from '../models/workflow-execution.js';
import { ExecutionReportModel } from '../models/execution-report.js';
import { deterministicUuid, newId } from '../utils/ids.js';
import type { Prisma } from '@prisma/client';

const CONTEXT_KEY = 'orchestratorContext';

/** A {@link MemoryStore} view over the orchestrator repository. */
export class RepositoryMemoryStore implements MemoryStore {
  constructor(private readonly repository: OrchestratorRepository) {}

  async add(
    entry: Omit<MemoryEntry, 'id' | 'createdAt'>,
    now: () => Date = () => new Date(),
  ): Promise<MemoryEntry> {
    const record: MemoryEntry = { ...entry, id: newId(), createdAt: now() };
    await this.repository.addMemory(record);
    return record;
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.repository.queryMemory(query);
  }

  async latest(storeId: string, kind: MemoryEntry['kind'], key: string): Promise<MemoryEntry | null> {
    const results = await this.repository.queryMemory({ storeId, kind, key, limit: 1 });
    return results[0] ?? null;
  }
}

export interface OrchestratorOptions {
  registry?: AgentRegistry;
  providers: ProviderFactory;
  planner?: WorkflowPlanner;
  contextBuilder?: ContextBuilder;
  promptBuilder?: PromptBuilder;
  validator?: ResponseValidator;
  safety?: SafetyGuard;
  memory?: MemoryStore;
  repository?: OrchestratorRepository;
  eventBus?: EventBus;
  metrics?: MetricsRegistry;
  logger?: Logger;
  scheduler?: Scheduler;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxRatePerSecond?: number;
  defaultMaxAttempts?: number;
  defaultTimeoutMs?: number;
}

export interface StartWorkflowOptions {
  storeId?: string;
  inputs: Record<string, unknown>;
  contextSources?: Omit<ContextSources, 'storeId'>;
  timeoutMs?: number;
  maxConcurrency?: number;
  signal?: AbortSignal;
}

export interface RunAgentTaskOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Top-level facade for the AI orchestrator. Coordinates specialist agents
 * into workflows; every workflow's business decisions come from the decision
 * engine (an {@link ExecutionPlan} converted by the planner). The orchestrator
 * itself performs no SEO work.
 */
export class Orchestrator {
  private readonly registry: AgentRegistry;
  private readonly providers: ProviderFactory;
  private readonly planner: WorkflowPlanner;
  private readonly contextBuilder: ContextBuilder;
  private readonly promptBuilder: PromptBuilder;
  private readonly memory: MemoryStore;
  private readonly repository: OrchestratorRepository;
  private readonly eventBus: EventBus | undefined;
  private readonly metrics: MetricsRegistry | undefined;
  private readonly logger: Logger | undefined;
  private readonly scheduler: Scheduler | undefined;
  private readonly now: () => Date;
  private readonly executor: AgentExecutor;
  private readonly workflowEngine: WorkflowEngine;
  private readonly cancellations = new Map<string, AbortController>();
  private readonly sink: EventSink;

  constructor(options: OrchestratorOptions) {
    if (options.providers === undefined) {
      throw new ValidationError('Orchestrator requires a provider factory', {
        module: 'ai-orchestrator',
        operation: 'orchestrator.construct',
      });
    }
    this.registry = options.registry ?? new AgentRegistry();
    this.providers = options.providers;
    this.repository = options.repository ?? new InMemoryOrchestratorRepository();
    this.memory = options.memory ?? new RepositoryMemoryStore(this.repository);
    this.eventBus = options.eventBus;
    this.metrics = options.metrics;
    this.logger = options.logger;
    this.scheduler = options.scheduler;
    this.now = options.now ?? (() => new Date());
    this.contextBuilder = options.contextBuilder ?? new DefaultContextBuilder();
    this.promptBuilder = options.promptBuilder ?? new DefaultPromptBuilder();

    this.sink = {
      emit: (event: OrchestratorEvent) => this.publishEvent(event),
      validationFailed: (event: ValidationFailedEvent) =>
        this.publishEvent({ type: 'validation.failed', ...event }),
    };

    this.executor = new AgentRunner({
      providers: this.providers,
      registry: this.registry,
      promptBuilder: this.promptBuilder,
      validator: options.validator ?? new DefaultResponseValidator(),
      safety: options.safety ?? new DefaultSafetyGuard(),
      memory: this.memory,
      eventSink: this.sink,
      now: this.now,
    });

    const taskFactory: AgentTaskFactory = {
      build: (step, workflow) => this.buildTask(step, workflow),
    };
    const executionEngine = new ExecutionEngine({
      executor: this.executor,
      sleep: options.sleep,
      now: this.now,
      maxRatePerSecond: options.maxRatePerSecond,
      eventSink: this.sink,
      metrics: this.metrics,
      logger: this.logger,
    });
    this.workflowEngine = new WorkflowEngine({
      executionEngine,
      taskFactory,
      now: this.now,
      eventSink: this.sink,
      metrics: this.metrics,
      logger: this.logger,
      onCheckpoint: async (execution) => {
        await this.repository.saveCheckpoint(execution);
      },
      defaultMaxAttempts: options.defaultMaxAttempts ?? 1,
      defaultTimeoutMs: options.defaultTimeoutMs ?? 0,
    });
    this.planner = options.planner ?? new WorkflowPlanner({ registry: this.registry });
  }

  // --- Agent registry ---

  registerAgent(definition: AgentDefinition): AgentDefinition {
    return this.registry.register(definition);
  }

  unregisterAgent(id: string): void {
    this.registry.unregister(id);
  }

  listAgents(): AgentDefinition[] {
    return this.registry.list();
  }

  getAgent(id: string): AgentDefinition {
    return this.registry.get(id);
  }

  updateAgentHealth(
    id: string,
    status: AgentDefinition['health']['status'],
    detail?: string,
  ): AgentDefinition {
    return this.registry.updateHealth(id, {
      status,
      lastCheckedAt: this.now(),
      ...(detail === undefined ? {} : { detail }),
    });
  }

  // --- Planning ---

  planWorkflow(executionPlan: ExecutionPlan, options: PlanWorkflowOptions = {}): AgentWorkflow {
    const workflow = this.planner.plan(executionPlan, options);
    void this.repository.saveWorkflowDefinition(workflow.definition);
    return workflow;
  }

  // --- Execution ---

  /** Runs a workflow (from the planner or a hand-built definition). */
  async startWorkflow(
    workflow: AgentWorkflow | WorkflowDefinition,
    options: StartWorkflowOptions,
  ): Promise<WorkflowResult> {
    const definition = isAgentWorkflow(workflow) ? workflow.definition : workflow;
    const storeId =
      options.storeId ?? (isAgentWorkflow(workflow) ? workflow.source.storeId : '') ?? '';
    const inputs: Record<string, unknown> = {
      ...options.inputs,
      [CONTEXT_KEY]: options.contextSources ?? {},
    };
    const controller = new AbortController();
    const executionId = WorkflowExecutionModel.idFor(definition.id, storeId);
    if (this.cancellations.has(executionId)) {
      throw new ValidationError(`A workflow "${executionId}" is already running`, {
        module: 'ai-orchestrator',
        operation: 'orchestrator.startWorkflow',
      });
    }
    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }
    this.cancellations.set(executionId, controller);

    try {
      await this.repository.saveWorkflowDefinition(definition);
      const result = await this.workflowEngine.run(definition, inputs, {
        signal: controller.signal,
        storeId,
        timeoutMs: options.timeoutMs,
        maxConcurrency: options.maxConcurrency,
      });
      await this.repository.saveExecution(result.execution);
      await this.repository.saveTrace(result.trace);
      await this.memory.add(
        {
          storeId,
          workflowId: result.execution.id,
          kind: 'execution',
          key: `workflow:${definition.id}`,
          data: {
            status: result.execution.status,
            definitionId: definition.id,
            startedAt: result.execution.startedAt.toISOString(),
            completedAt: result.execution.completedAt?.toISOString() ?? null,
          },
        },
        this.now,
      );
      return result;
    } finally {
      this.cancellations.delete(executionId);
      if (options.signal !== undefined) {
        options.signal.removeEventListener('abort', () => controller.abort());
      }
    }
  }

  /** Cancels a running workflow (the engine marks it CANCELLED). */
  cancelWorkflow(executionId: string): void {
    const controller = this.cancellations.get(executionId);
    if (controller === undefined) {
      throw new NotFoundError(`No running workflow "${executionId}"`, {
        module: 'ai-orchestrator',
        operation: 'orchestrator.cancelWorkflow',
      });
    }
    controller.abort();
  }

  /** Resumes a checkpointed workflow, skipping already-completed steps. */
  async recoverWorkflow(executionId: string): Promise<WorkflowResult> {
    const checkpoint = await this.repository.getCheckpoint(executionId);
    if (checkpoint === null) {
      throw new NotFoundError(`No checkpoint for workflow "${executionId}"`, {
        module: 'ai-orchestrator',
        operation: 'orchestrator.recoverWorkflow',
      });
    }
    const definition = await this.repository.getWorkflowDefinition(checkpoint.definitionId);
    if (definition === null) {
      throw new NotFoundError(
        `Definition "${checkpoint.definitionId}" required for recovery is missing`,
        { module: 'ai-orchestrator', operation: 'orchestrator.recoverWorkflow' },
      );
    }
    const controller = new AbortController();
    const result = await this.workflowEngine.run(definition, checkpoint.inputs, {
      storeId: checkpoint.storeId,
      startFrom: checkpoint,
      signal: controller.signal,
    });
    await this.repository.saveExecution(result.execution);
    await this.repository.saveTrace(result.trace);
    return result;
  }

  /** Runs a single agent task directly (provider call + validation + safety). */
  async runAgentTask(task: AgentTask, options: RunAgentTaskOptions = {}): Promise<AgentResult> {
    const agent = this.registry.get(task.agentId);
    this.sink.emit({
      type: 'agent.started',
      workflowId: task.workflowId,
      stepId: task.stepId,
      taskId: task.id,
      agentId: task.agentId,
      agentName: agent.name,
      provider: agent.provider,
      model: agent.model,
    });
    try {
      const result = await this.executor.execute(task, {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? task.timeoutMs ?? 0,
        attempt: 1,
      });
      this.sink.emit({
        type: 'agent.completed',
        workflowId: task.workflowId,
        stepId: task.stepId,
        taskId: task.id,
        agentId: task.agentId,
        agentName: agent.name,
        provider: agent.provider,
        model: agent.model,
        latencyMs: result.latencyMs,
        totalTokens: result.tokens.totalTokens,
        costEstimate: result.costEstimate,
      });
      this.metrics?.observe('agent_duration', result.latencyMs);
      this.metrics?.observe('provider_latency', result.latencyMs);
      this.metrics?.increment('token_usage', result.tokens.totalTokens);
      this.metrics?.increment('estimated_cost', result.costEstimate);
      return result;
    } catch (error) {
      this.metrics?.increment('agent_failures');
      this.sink.emit({
        type: 'agent.failed',
        workflowId: task.workflowId,
        stepId: task.stepId,
        taskId: task.id,
        agentId: task.agentId,
        agentName: agent.name,
        provider: agent.provider,
        model: agent.model,
        error: error instanceof Error ? error.message : String(error),
        retryable: false,
        attempt: 1,
      });
      throw error;
    }
  }

  // --- Reads ---

  async getExecution(id: string): Promise<WorkflowExecution | null> {
    return this.repository.getExecution(id);
  }

  async getTrace(executionId: string): Promise<ExecutionTrace | null> {
    return this.repository.getTrace(executionId);
  }

  async getReport(executionId: string): Promise<ExecutionReport> {
    const execution = await this.repository.getExecution(executionId);
    if (execution === null) {
      throw new NotFoundError(`Workflow execution "${executionId}" was not found`, {
        module: 'ai-orchestrator',
        operation: 'orchestrator.getReport',
      });
    }
    return ExecutionReportModel.fromExecution(execution);
  }

  async queryMemory(query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.repository.queryMemory(query);
  }

  // --- Internal ---

  private async buildTask(
    step: AgentWorkflowStep,
    workflow: WorkflowExecution,
  ): Promise<AgentTask> {
    const agent = this.registry.get(step.agentId);
    const rawSources = workflow.inputs[CONTEXT_KEY] as Record<string, unknown> | undefined;
    const sources = {
      ...(rawSources === undefined ? {} : rawSources),
      storeId: workflow.storeId,
    } as ContextSources;
    const taskId = deterministicUuid('agent-task', `${workflow.id}\u0000${step.id}`);
    const context: PromptContext = this.contextBuilder.build(sources, {
      task: {
        id: taskId,
        agentId: step.agentId,
        name: step.name ?? step.taskTemplate,
        description: step.taskTemplate,
      },
      budget: { maxTokens: 4000, maxSectionTokens: 1200 },
    });
    return {
      id: taskId,
      workflowId: workflow.id,
      stepId: step.id,
      agentId: step.agentId,
      name: step.name ?? step.taskTemplate,
      description: step.taskTemplate,
      input: workflow.inputs,
      context,
      provider: agent.provider,
      model: agent.model,
      expectedSchema: step.schema,
      allowedActions: step.allowedActions,
      maxAttempts: step.maxAttempts,
      timeoutMs: step.timeoutMs,
    };
  }

  private async publishEvent(event: OrchestratorEvent): Promise<void> {
    if (this.eventBus === undefined) return;
    try {
      await this.eventBus.publish({
        type: event.type,
        aggregateType: 'workflow',
        aggregateId: event.workflowId,
        payload: event as unknown as Prisma.InputJsonValue,
      });
    } catch (error) {
      this.logger?.error(
        { event: event.type, workflowId: event.workflowId, error: String(error) },
        'failed to publish orchestrator event',
      );
    }
  }
}

function isAgentWorkflow(value: AgentWorkflow | WorkflowDefinition): value is AgentWorkflow {
  return (
    (value as AgentWorkflow).source !== undefined &&
    (value as AgentWorkflow).definition !== undefined
  );
}

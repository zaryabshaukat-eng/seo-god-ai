import type { Prisma } from '@prisma/client';
import type { EventBus } from '@seogod/events';
import { ValidationError } from '@seogod/core';
import type { Logger } from '@seogod/logging';
import { serializeError } from '@seogod/logging';
import type { MetricsRegistry } from '@seogod/monitoring';
import type { Agent } from '../interfaces/agent.js';
import { ContextBuilderImpl, type ContextBuilder } from '../context/context-builder.js';
import { AgentMemory, type AgentMemoryStore } from '../memory/agent-memory.js';
import { AgentRunModel } from '../models/agent-run.js';
import { PromptLoaderImpl, renderPrompt, type PromptLoader } from '../prompts/prompt-loader.js';
import { AgentRegistry } from '../registry/agent-registry.js';
import {
  InMemoryAgentRepository,
  type AgentRepository,
  type PerformanceSnapshot,
  type RunFilter,
} from '../repositories/agent-repository.js';
import { DefaultSafetyGuard, type SafetyGuard } from '../safety/safety-guard.js';
import type { AgentDefinition } from '../types/agent.js';
import type { AgentContext, ContextBudget } from '../types/context.js';
import type { AgentEvent } from '../types/events.js';
import type { AgentInput } from '../types/input.js';
import type { AgentRunRecord, FeedbackRecord, MemoryEntry, MemoryQuery } from '../types/memory.js';
import type { AgentResult } from '../types/output.js';
import type { ValidationFailure } from '../types/validation.js';
import { OutputValidator } from '../validation/output-validator.js';
import { validateSchema } from '../validation/schema.js';
import { SafetyViolationError } from '../utils/errors.js';

export interface AgentServiceOptions {
  registry?: AgentRegistry;
  repository?: AgentRepository;
  memory?: AgentMemoryStore;
  validator?: OutputValidator;
  safety?: SafetyGuard;
  contextBuilder?: ContextBuilder;
  promptLoader?: PromptLoader;
  eventBus?: EventBus;
  metrics?: MetricsRegistry;
  logger?: Logger;
  now?: () => Date;
  costPer1kTokens?: number;
  model?: string;
}

export interface InvokeOptions {
  budget?: ContextBudget;
  model?: string;
}

export interface AgentInvokeResult {
  result: AgentResult;
  context: AgentContext;
  run: AgentRunRecord;
  durationMs: number;
  model: string;
}

const DEFAULT_COST_PER_1K_TOKENS = 0.002;

/**
 * Top-level facade for the agents package. Registers agents, invokes them,
 * validates their output against the strict contract, enforces the safety
 * policy, and records runs/metrics/events/memory around every invocation.
 * Agents never execute changes - they produce validated proposals only.
 */
export class AgentService {
  private readonly registry: AgentRegistry;
  private readonly repository: AgentRepository;
  private readonly memory: AgentMemoryStore;
  private readonly validator: OutputValidator;
  private readonly safety: SafetyGuard;
  private readonly contextBuilder: ContextBuilder;
  private readonly promptLoader: PromptLoader;
  private readonly eventBus: EventBus | undefined;
  private readonly metrics: MetricsRegistry | undefined;
  private readonly logger: Logger | undefined;
  private readonly now: () => Date;
  private readonly costPer1kTokens: number;
  private readonly model: string;
  private runCount = 0;
  private confidenceTotal = 0;
  private tokenTotal = 0;
  private costTotal = 0;

  constructor(options: AgentServiceOptions) {
    this.registry = options.registry ?? new AgentRegistry();
    this.repository = options.repository ?? new InMemoryAgentRepository();
    this.memory = options.memory ?? new AgentMemory(this.repository, options.now);
    this.validator = options.validator ?? new OutputValidator();
    this.safety = options.safety ?? new DefaultSafetyGuard();
    this.contextBuilder = options.contextBuilder ?? new ContextBuilderImpl();
    this.promptLoader = options.promptLoader ?? new PromptLoaderImpl();
    this.eventBus = options.eventBus;
    this.metrics = options.metrics;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.costPer1kTokens = options.costPer1kTokens ?? DEFAULT_COST_PER_1K_TOKENS;
    this.model = options.model ?? 'local-deterministic';
  }

  // --- Registration / reads ---

  register(agent: Agent): AgentDefinition {
    const definition = this.registry.register(agent);
    void this.emit({
      type: 'agent.registered',
      agentId: agent.id,
      agentName: agent.name,
      version: agent.version,
      capabilities: [...agent.capabilities],
    });
    this.logger?.info(
      { agentId: agent.id, agentName: agent.name, version: agent.version },
      'agent registered',
    );
    return definition;
  }

  unregister(id: string): void {
    this.registry.unregister(id);
  }

  getAgent(id: string): AgentDefinition {
    return this.registry.get(id).definition();
  }

  hasAgent(id: string): boolean {
    return this.registry.has(id);
  }

  listAgents(): AgentDefinition[] {
    return this.registry.listDefinitions();
  }

  // --- Invocation ---

  async invoke(agentId: string, input: AgentInput, options: InvokeOptions = {}): Promise<AgentInvokeResult> {
    const startedAt = this.now();
    const agent = this.registry.get(agentId);
    const model = options.model ?? this.model;

    const inputFailures = validateSchema(input, agent.inputSchema).map((violation) => ({
      code: 'schema' as const,
      path: violation.path,
      message: violation.message,
    }));
    if (inputFailures.length > 0) {
      await this.recordInputFailure(agent, input, inputFailures);
      throw new ValidationError('Agent input failed schema validation', {
        module: 'agents',
        operation: 'agents.invoke',
        context: { agentId: agent.id, taskId: input.taskId, failures: inputFailures },
      });
    }

    const context = this.contextBuilder.build(input, { agentId: agent.id, budget: options.budget });
    this.metrics?.increment('agent_runs');
    await this.emit({
      type: 'agent.invoked',
      agentId: agent.id,
      agentName: agent.name,
      version: agent.version,
      taskId: input.taskId,
      workflowId: input.workflowId,
      storeId: input.storeId,
    });

    let result: AgentResult;
    try {
      result = agent.analyze(input);
    } catch (error) {
      await this.recordUnexpectedFailure(agent, input, startedAt, model, error);
      throw error;
    }

    const completedAt = this.now();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    const costEstimate = this.costFor(context.tokenEstimate);

    const failures = this.validator.validate(result, agent);
    if (failures.length > 0) {
      await this.recordOutputFailure(agent, input, failures, result);
      throw new ValidationError('Agent output failed validation', {
        module: 'agents',
        operation: 'agents.invoke',
        context: { agentId: agent.id, taskId: input.taskId, failures },
      });
    }

    let safeResult: AgentResult;
    try {
      safeResult = this.safety.assertSafeResult(result, input);
    } catch (error) {
      if (error instanceof SafetyViolationError) {
        const failures: ValidationFailure[] = [
          { code: 'safety', path: '$.actions', message: error.message },
        ];
        await this.recordOutputFailure(agent, input, failures, result, 'safety violation');
        throw error;
      }
      throw error;
    }

    const run = AgentRunModel.build({
      agentId: agent.id,
      name: agent.name,
      version: agent.version,
      taskId: input.taskId,
      workflowId: input.workflowId,
      storeId: input.storeId,
      status: safeResult.status,
      startedAt,
      completedAt,
      durationMs,
      tokenEstimate: context.tokenEstimate,
      costEstimate,
      confidence: safeResult.confidence,
      risk: safeResult.risk,
      recommendationCount: safeResult.recommendations.length,
      actionCount: safeResult.actions.length,
      model,
    });
    await this.repository.saveRun(run);
    await this.memory.recordHistory({
      storeId: input.storeId,
      agentId: agent.id,
      workflowId: input.workflowId,
      result: safeResult,
    });
    await this.memory.recordExecution({ storeId: input.storeId, agentId: agent.id, run });
    await this.memory.recordPerformance({ storeId: input.storeId, agentId: agent.id, run });

    this.metrics?.observe('agent_duration', durationMs);
    this.metrics?.increment('token_usage', context.tokenEstimate);
    this.metrics?.increment('estimated_cost', costEstimate);
    this.updateAverages(safeResult.confidence, context.tokenEstimate, costEstimate);

    await this.emit({
      type: 'agent.completed',
      agentId: agent.id,
      agentName: agent.name,
      version: agent.version,
      taskId: input.taskId,
      workflowId: input.workflowId,
      storeId: input.storeId,
      status: safeResult.status,
      durationMs,
      tokenEstimate: context.tokenEstimate,
      costEstimate,
      recommendationCount: safeResult.recommendations.length,
      actionCount: safeResult.actions.length,
      confidence: safeResult.confidence,
    });
    for (const recommendation of safeResult.recommendations) {
      await this.emit({
        type: 'recommendation.generated',
        agentId: agent.id,
        agentName: agent.name,
        version: agent.version,
        taskId: input.taskId,
        workflowId: input.workflowId,
        storeId: input.storeId,
        rule: recommendation.rule,
        severity: recommendation.severity,
        confidence: recommendation.confidence,
        estimatedImpact: recommendation.estimatedImpact,
      });
    }

    this.logger?.info(
      {
        agentId: agent.id,
        workflowId: input.workflowId,
        taskId: input.taskId,
        model,
        duration: durationMs,
        tokenUsage: context.tokenEstimate,
        costEstimate,
        status: safeResult.status,
      },
      'agent completed',
    );

    return { result: safeResult, context, run, durationMs, model };
  }

  // --- Feedback & rejection ---

  async rejectRecommendation(params: {
    storeId: string;
    agentId: string;
    taskId: string;
    workflowId?: string;
    rule: string;
    reason: string;
  }): Promise<void> {
    const agent = this.registry.get(params.agentId);
    const failures: ValidationFailure[] = [
      { code: 'safety', path: `$.recommendations[${params.rule}]`, message: params.reason },
    ];
    await this.memory.recordValidationFailure({
      storeId: params.storeId,
      agentId: params.agentId,
      taskId: params.taskId,
      workflowId: params.workflowId,
      failures,
    });
    await this.emit({
      type: 'recommendation.rejected',
      agentId: params.agentId,
      agentName: agent.name,
      version: agent.version,
      taskId: params.taskId,
      workflowId: params.workflowId ?? '',
      storeId: params.storeId,
      rule: params.rule,
      reason: params.reason,
    });
  }

  async recordFeedback(params: {
    storeId: string;
    agentId: string;
    taskId: string;
    workflowId?: string;
    rating: number;
    comment?: string;
  }): Promise<FeedbackRecord> {
    this.registry.get(params.agentId);
    return this.memory.recordFeedback(params);
  }

  // --- Prompt rendering ---

  /** Renders the agent's versioned prompt for a given input. */
  renderPrompt(agentId: string, input: AgentInput): string {
    const agent = this.registry.get(agentId);
    const template = this.promptLoader.load(agent.promptId);
    const context = this.contextBuilder.build(input, { agentId: agent.id });
    const entities = context.sections.find((section) => section.id === 'entities')?.content ?? input.entities;
    return renderPrompt(template, {
      storeId: input.storeId,
      workflowId: input.workflowId,
      taskId: input.taskId,
      entityCount: String(input.entities.length),
      entities: JSON.stringify(entities),
      settings: JSON.stringify(input.settings ?? {}),
      context: JSON.stringify(input.context ?? {}),
      allowedActions: agent.supportedActionTypes.join(', '),
    });
  }

  // --- Reads ---

  async queryMemory(query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.memory.query(query);
  }

  async getRun(id: string): Promise<AgentRunRecord | null> {
    return this.repository.getRun(id);
  }

  async listRuns(filter?: RunFilter): Promise<AgentRunRecord[]> {
    return this.repository.listRuns(filter);
  }

  async performanceSnapshot(storeId: string, agentId: string): Promise<PerformanceSnapshot> {
    return this.repository.performanceSnapshot({ storeId, agentId });
  }

  // --- Internal ---

  private async recordInputFailure(agent: Agent, input: AgentInput, failures: ValidationFailure[]): Promise<void> {
    await this.memory.recordValidationFailure({
      storeId: input.storeId,
      agentId: agent.id,
      taskId: input.taskId,
      workflowId: input.workflowId,
      failures,
    });
    this.metrics?.increment('validation_failures', failures.length);
    await this.emit({
      type: 'agent.failed',
      agentId: agent.id,
      agentName: agent.name,
      version: agent.version,
      taskId: input.taskId,
      workflowId: input.workflowId,
      storeId: input.storeId,
      error: 'input validation failed',
      retryable: false,
    });
    this.metrics?.increment('agent_failures');
  }

  private async recordOutputFailure(
    agent: Agent,
    input: AgentInput,
    failures: ValidationFailure[],
    result: AgentResult,
    error = 'output validation failed',
  ): Promise<void> {
    await this.memory.recordValidationFailure({
      storeId: input.storeId,
      agentId: agent.id,
      taskId: input.taskId,
      workflowId: input.workflowId,
      failures,
    });
    this.metrics?.increment('validation_failures', failures.length);
    for (const recommendation of result.recommendations) {
      await this.emit({
        type: 'recommendation.rejected',
        agentId: agent.id,
        agentName: agent.name,
        version: agent.version,
        taskId: input.taskId,
        workflowId: input.workflowId,
        storeId: input.storeId,
        rule: recommendation.rule,
        reason: error,
      });
    }
    await this.emit({
      type: 'agent.failed',
      agentId: agent.id,
      agentName: agent.name,
      version: agent.version,
      taskId: input.taskId,
      workflowId: input.workflowId,
      storeId: input.storeId,
      error,
      retryable: false,
    });
    this.metrics?.increment('agent_failures');
  }

  private async recordUnexpectedFailure(
    agent: Agent,
    input: AgentInput,
    startedAt: Date,
    model: string,
    error: unknown,
  ): Promise<void> {
    const completedAt = this.now();
    const run = AgentRunModel.build({
      agentId: agent.id,
      name: agent.name,
      version: agent.version,
      taskId: input.taskId,
      workflowId: input.workflowId,
      storeId: input.storeId,
      status: 'FAILED',
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      tokenEstimate: 0,
      costEstimate: 0,
      confidence: 0,
      risk: 'HIGH',
      recommendationCount: 0,
      actionCount: 0,
      model,
      error: error instanceof Error ? error.message : String(error),
    });
    await this.repository.saveRun(run);
    this.metrics?.increment('agent_failures');
    await this.emit({
      type: 'agent.failed',
      agentId: agent.id,
      agentName: agent.name,
      version: agent.version,
      taskId: input.taskId,
      workflowId: input.workflowId,
      storeId: input.storeId,
      error: error instanceof Error ? error.message : String(error),
      retryable: false,
    });
    this.logger?.error(
      {
        agentId: agent.id,
        workflowId: input.workflowId,
        taskId: input.taskId,
        model,
        error: serializeError(error),
      },
      'agent failed',
    );
  }

  private async emit(event: AgentEvent): Promise<void> {
    if (this.eventBus === undefined) return;
    try {
      await this.eventBus.publish({
        type: event.type,
        aggregateType: event.type === 'agent.registered' ? 'agent' : 'workflow',
        aggregateId: event.type === 'agent.registered' ? event.agentId : event.workflowId,
        payload: event as unknown as Prisma.InputJsonValue,
      });
    } catch (error) {
      this.logger?.error(
        { event: event.type, error: String(error) },
        'failed to publish agent event',
      );
    }
  }

  private costFor(tokenEstimate: number): number {
    return roundTo((tokenEstimate / 1000) * this.costPer1kTokens, 6);
  }

  private updateAverages(confidence: number, tokens: number, cost: number): void {
    this.runCount += 1;
    this.confidenceTotal += confidence;
    this.tokenTotal += tokens;
    this.costTotal += cost;
    this.metrics?.setGauge('average_confidence', roundTo(this.confidenceTotal / this.runCount, 4));
    this.metrics?.setGauge('average_tokens', roundTo(this.tokenTotal / this.runCount, 2));
    this.metrics?.setGauge('estimated_cost', roundTo(this.costTotal / this.runCount, 6));
  }
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

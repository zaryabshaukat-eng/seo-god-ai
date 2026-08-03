import type { AgentResult, AgentTask } from '../types/agent.js';
import type { EventSink } from '../types/events.js';
import type { ProviderFactory } from '../providers/provider-factory.js';
import type { ProviderMessage } from '../types/provider.js';
import type { AgentRegistry } from '../registry/agent-registry.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { PromptBuilder } from '../prompts/prompt-builder.js';
import { ResponseValidator } from '../validation/response-validator.js';
import { SafetyGuard } from '../safety/safety-guard.js';
import { ValidationFailedError, SafetyViolationError } from '../errors.js';
import { estimateCost } from '../utils/cost.js';

export interface AgentExecutorOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  attempt: number;
}

/** Executes one agent task end-to-end (provider call + validation + safety). */
export interface AgentExecutor {
  execute(task: AgentTask, options: AgentExecutorOptions): Promise<AgentResult>;
}

export interface AgentRunnerOptions {
  providers: ProviderFactory;
  registry: AgentRegistry;
  promptBuilder: PromptBuilder;
  validator?: ResponseValidator;
  safety?: SafetyGuard;
  memory?: MemoryStore;
  eventSink?: EventSink;
  now?: () => Date;
}

/** Renders an agent task into provider messages (no inline prompts). */
function buildMessages(
  task: AgentTask,
  agent: { name: string; version: string; capabilities: string[] },
  promptBuilder: PromptBuilder,
  contextJson: string,
  schemaJson: string,
): ProviderMessage[] {
  const instructions = promptBuilder.render('agent.task', {
    agentName: agent.name,
    agentVersion: agent.version,
    capabilities: agent.capabilities.join(', '),
    taskName: task.name,
    taskDescription: task.description,
    contextJson,
    schemaJson,
  });
  const system = promptBuilder.render('system.context', {});
  return [
    { role: 'system', content: system },
    { role: 'user', content: instructions },
  ];
}

function structuredData(validationData: unknown): Record<string, unknown> | null {
  if (
    validationData !== null &&
    typeof validationData === 'object' &&
    !Array.isArray(validationData)
  ) {
    return validationData as Record<string, unknown>;
  }
  return null;
}

/**
 * Default {@link AgentExecutor}. Calls the provider, validates the response
 * against the task schema, applies the safety gate, estimates cost, and
 * records the outcome in memory. Rejects invalid/unsafe output.
 */
export class AgentRunner implements AgentExecutor {
  private readonly providers: ProviderFactory;
  private readonly registry: AgentRegistry;
  private readonly promptBuilder: PromptBuilder;
  private readonly validator: ResponseValidator;
  private readonly safety: SafetyGuard;
  private readonly memory: MemoryStore | undefined;
  private readonly eventSink: EventSink | undefined;
  private readonly now: () => Date;

  constructor(options: AgentRunnerOptions) {
    this.providers = options.providers;
    this.registry = options.registry;
    this.promptBuilder = options.promptBuilder;
    this.validator = options.validator ?? new ResponseValidator();
    this.safety = options.safety ?? new SafetyGuard();
    this.memory = options.memory;
    this.eventSink = options.eventSink;
    this.now = options.now ?? (() => new Date());
  }

  async execute(task: AgentTask, options: AgentExecutorOptions): Promise<AgentResult> {
    const agent = this.registry.get(task.agentId);
    const provider = this.providers.get(agent.provider);
    const schema = task.expectedSchema;
    const schemaJson = schema === undefined ? '{}' : JSON.stringify(schema);
    const contextJson = JSON.stringify({
      taskInput: task.input,
      sections: task.context.sections,
    });

    const messages = buildMessages(task, agent, this.promptBuilder, contextJson, schemaJson);
    const startedAt = this.now();
    const response = await provider.complete(
      { model: agent.model, messages },
      { signal: options.signal, timeoutMs: options.timeoutMs },
    );
    const latencyMs = this.now().getTime() - startedAt.getTime();
    const costEstimate = estimateCost(
      response.model,
      response.usage.promptTokens,
      response.usage.completionTokens,
    );

    const validation = this.validator.validate(response.text, schema);
    if (!validation.ok) {
      const issues = validation.issues.map((issue) => issue.message);
      this.eventSink?.validationFailed?.({
        workflowId: task.workflowId,
        stepId: task.stepId,
        taskId: task.id,
        agentId: task.agentId,
        issues,
      });
      await this.memory?.add(
        {
          storeId: task.context.storeId,
          workflowId: task.workflowId,
          agentId: task.agentId,
          taskId: task.id,
          kind: 'validation',
          key: `validation:${task.agentId}`,
          data: { issues },
        },
        this.now,
      );
      throw new ValidationFailedError(
        `Agent "${task.agentId}" response failed validation: ${issues.join('; ')}`,
        { workflowId: task.workflowId, stepId: task.stepId, taskId: task.id, agentId: task.agentId },
      );
    }

    const decision = this.safety.evaluate(
      { text: response.text, data: validation.data, schema },
      { allowedActions: task.allowedActions },
    );
    if (!decision.ok) {
      throw new SafetyViolationError(
        `Agent "${task.agentId}" output blocked by safety: ${decision.reason ?? 'unknown'}`,
        { workflowId: task.workflowId, stepId: task.stepId, taskId: task.id, agentId: task.agentId },
      );
    }

    const data = structuredData(validation.data);
    await this.memory?.add(
      {
        storeId: task.context.storeId,
        workflowId: task.workflowId,
        agentId: task.agentId,
        taskId: task.id,
        kind: 'agent-output',
        key: `agent:${task.agentId}`,
        data: {
          text: response.text,
          data,
          costEstimate,
          tokens: response.usage,
        },
      },
      this.now,
    );

    return {
      taskId: task.id,
      stepId: task.stepId,
      agentId: task.agentId,
      workflowId: task.workflowId,
      text: response.text,
      data,
      tokens: response.usage,
      costEstimate,
      latencyMs,
      provider: agent.provider,
      model: response.model,
      completedAt: this.now(),
    };
  }
}

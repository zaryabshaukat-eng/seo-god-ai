import type { MetricsRegistry } from '@seogod/monitoring';
import type { Logger } from '@seogod/logging';
import type { AgentTask, AgentResult } from '../types/agent.js';
import type { AgentExecution } from '../types/execution.js';
import type { EventSink } from '../types/events.js';
import type { AgentWorkflowStep, WorkflowDefinition } from '../types/workflow.js';
import { AgentExecutionModel } from '../models/agent-execution.js';
import { CancelledError, OrchestratorError } from '../errors.js';
import { withTimeout, isAborted } from '../utils/async.js';
import { backoffDelay, errorMessage, isRetryable } from '../utils/retry.js';
import { RateLimiter } from './rate-limiter.js';
import type { AgentExecutor } from './agent-runner.js';

export interface AgentStepContext {
  workflowId: string;
  storeId: string;
  definition: WorkflowDefinition;
  inputs: Record<string, unknown>;
  signal: AbortSignal | undefined;
  defaultMaxAttempts: number;
  defaultTimeoutMs: number;
  buildTask(step: AgentWorkflowStep): Promise<AgentTask>;
  trace(type: string, data?: Record<string, unknown>): void;
}

export interface ExecutionEngineOptions {
  executor: AgentExecutor;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  maxRatePerSecond?: number;
  eventSink?: EventSink;
  metrics?: MetricsRegistry;
  logger?: Logger;
}

export interface AgentStepResult {
  result: AgentResult;
  executions: AgentExecution[];
}

/**
 * Runs a single agent workflow step with the full execution-engine
 * guarantees: retries on retryable failures, per-step timeouts, abort
 * support, and cross-call rate limiting. Emits agent lifecycle events,
 * metrics, and trace events.
 */
export class ExecutionEngine {
  private readonly executor: AgentExecutor;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly rateLimiter: RateLimiter;
  private readonly eventSink: EventSink | undefined;
  private readonly metrics: MetricsRegistry | undefined;
  private readonly logger: Logger | undefined;

  constructor(options: ExecutionEngineOptions) {
    this.executor = options.executor;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => new Date());
    this.rateLimiter = new RateLimiter({
      maxPerSecond: options.maxRatePerSecond,
      sleep: this.sleep,
      now: () => this.now().getTime(),
    });
    this.eventSink = options.eventSink;
    this.metrics = options.metrics;
    this.logger = options.logger;
  }

  async executeAgentStep(
    step: AgentWorkflowStep,
    ctx: AgentStepContext,
  ): Promise<AgentStepResult> {
    const maxAttempts = step.maxAttempts ?? ctx.defaultMaxAttempts;
    const timeoutMs = step.timeoutMs ?? ctx.defaultTimeoutMs;
    const executions: AgentExecution[] = [];
    let lastError: unknown = new OrchestratorError(`agent step "${step.id}" failed`);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (isAborted(ctx.signal)) throw new CancelledError('workflow was cancelled');
      await this.rateLimiter.acquire();

      const task = await ctx.buildTask(step);
      const execution = AgentExecutionModel.create({
        taskId: task.id,
        stepId: step.id,
        agentId: step.agentId,
        workflowId: ctx.workflowId,
        storeId: ctx.storeId,
        provider: task.provider ?? 'unknown',
        model: task.model ?? 'unknown',
        attempt,
        now: this.now,
      });
      executions.push(execution);
      ctx.trace('agent.started', { stepId: step.id, attempt, agentId: step.agentId });
      this.emitAgentStarted(ctx, step, task, execution);

      try {
        const result = await withTimeout(
          this.executor.execute(task, { signal: ctx.signal, timeoutMs, attempt }),
          timeoutMs,
          ctx.signal,
        );
        const completed = AgentExecutionModel.complete(
          execution,
          {
            promptTokens: result.tokens.promptTokens,
            completionTokens: result.tokens.completionTokens,
            totalTokens: result.tokens.totalTokens,
            costEstimate: result.costEstimate,
            latencyMs: result.latencyMs,
          },
          this.now,
        );
        executions[executions.length - 1] = completed;
        this.metrics?.observe('agent_duration', completed.latencyMs);
        this.metrics?.observe('provider_latency', completed.latencyMs);
        this.metrics?.increment('token_usage', completed.totalTokens);
        this.metrics?.increment('estimated_cost', completed.costEstimate);
        this.logger?.info(
          {
            workflowId: ctx.workflowId,
            agentId: step.agentId,
            provider: completed.provider,
            model: completed.model,
            duration: completed.latencyMs,
            tokens: completed.totalTokens,
            costEstimate: completed.costEstimate,
            status: 'completed',
            stepId: step.id,
            attempt,
          },
          'agent completed',
        );
        ctx.trace('agent.completed', {
          stepId: step.id,
          attempt,
          agentId: step.agentId,
          tokens: completed.totalTokens,
          costEstimate: completed.costEstimate,
        });
        this.eventSink?.emit({
          type: 'agent.completed',
          workflowId: ctx.workflowId,
          stepId: step.id,
          taskId: task.id,
          agentId: step.agentId,
          agentName: step.agentId,
          provider: completed.provider,
          model: completed.model,
          latencyMs: completed.latencyMs,
          totalTokens: completed.totalTokens,
          costEstimate: completed.costEstimate,
        });
        return { result, executions };
      } catch (error) {
        const failed = AgentExecutionModel.fail(execution, errorMessage(error), this.now);
        executions[executions.length - 1] = failed;
        this.metrics?.increment('agent_failures');
        this.logger?.error(
          {
            workflowId: ctx.workflowId,
            agentId: step.agentId,
            provider: execution.provider,
            model: execution.model,
            duration: 0,
            tokens: 0,
            costEstimate: 0,
            status: 'failed',
            stepId: step.id,
            attempt,
            error: errorMessage(error),
          },
          'agent failed',
        );
        ctx.trace('agent.failed', {
          stepId: step.id,
          attempt,
          agentId: step.agentId,
          error: errorMessage(error),
        });
        this.eventSink?.emit({
          type: 'agent.failed',
          workflowId: ctx.workflowId,
          stepId: step.id,
          taskId: task.id,
          agentId: step.agentId,
          agentName: step.agentId,
          provider: execution.provider,
          model: execution.model,
          error: errorMessage(error),
          retryable: isRetryable(error),
          attempt,
        });

        lastError = error;
        const retryable = isRetryable(error);
        if (attempt >= maxAttempts || !retryable) {
          if (error instanceof CancelledError) throw error;
          throw error instanceof Error
            ? error
            : new OrchestratorError(String(error));
        }
        this.metrics?.increment('retry_count');
        ctx.trace('agent.retry', {
          stepId: step.id,
          attempt,
          nextAttempt: attempt + 1,
        });
        const delay = backoffDelay(attempt, { baseMs: 20, maxMs: 500 });
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private emitAgentStarted(
    ctx: AgentStepContext,
    step: AgentWorkflowStep,
    task: AgentTask,
    execution: AgentExecution,
  ): void {
    this.eventSink?.emit({
      type: 'agent.started',
      workflowId: ctx.workflowId,
      stepId: step.id,
      taskId: task.id,
      agentId: step.agentId,
      agentName: step.agentId,
      provider: execution.provider,
      model: execution.model,
    });
  }
}

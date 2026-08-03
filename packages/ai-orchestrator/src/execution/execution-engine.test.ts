import { describe, expect, it, vi } from 'vitest';
import { ExecutionEngine, type AgentStepContext } from './execution-engine.js';
import type { AgentExecutor } from './agent-runner.js';
import type { AgentTask } from '../types/agent.js';
import type { AgentWorkflowStep } from '../types/workflow.js';
import type { MetricsRegistry } from '@seogod/monitoring';
import type { Logger } from '@seogod/logging';
import type { EventSink } from '../types/events.js';
import { CancelledError, OrchestratorError, TimeoutError, ValidationFailedError } from '../errors.js';
import { agentResult, agentTask, workflowDefinition } from '../test/fixtures.js';

const step: AgentWorkflowStep = {
  id: 'step-a',
  kind: 'agent',
  agentId: 'title-writer',
  taskTemplate: 'do it',
  maxAttempts: 1,
  timeoutMs: 0,
};

function metricsSpy() {
  return {
    increment: vi.fn(),
    observe: vi.fn(),
    setGauge: vi.fn(),
  } as unknown as MetricsRegistry;
}

function loggerSpy() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

interface Harness {
  engine: ExecutionEngine;
  executor: AgentExecutor;
  events: EventSink;
  metrics: ReturnType<typeof metricsSpy>;
  sleep: ReturnType<typeof vi.fn>;
}

function buildHarness(options: { maxRatePerSecond?: number } = {}): Harness {
  const executor: AgentExecutor = { execute: vi.fn() };
  const events: EventSink = { emit: vi.fn() };
  const metrics = metricsSpy();
  const sleep = vi.fn(async () => undefined);
  const engine = new ExecutionEngine({
    executor,
    sleep,
    now: () => new Date('2026-01-01T00:00:00Z'),
    maxRatePerSecond: options.maxRatePerSecond,
    eventSink: events,
    metrics,
    logger: loggerSpy(),
  });
  return { engine, executor, events, metrics, sleep };
}

function context(overrides: Partial<AgentStepContext> = {}): AgentStepContext {
  return {
    workflowId: 'workflow-1',
    storeId: 'store-1',
    definition: workflowDefinition(),
    inputs: {},
    signal: undefined,
    defaultMaxAttempts: 1,
    defaultTimeoutMs: 0,
    buildTask: async (): Promise<AgentTask> => agentTask(),
    trace: vi.fn(),
    ...overrides,
  };
}

describe('ExecutionEngine', () => {
  it('executes a step successfully and emits lifecycle events', async () => {
    const { engine, executor, events, metrics } = buildHarness();
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue(agentResult());
    const result = await engine.executeAgentStep(step, context());
    expect(result.result.data).toEqual(agentResult().data);
    expect(result.executions).toHaveLength(1);
    expect(result.executions[0]?.status).toBe('COMPLETED');
    const types = (events.emit as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0].type);
    expect(types).toEqual(['agent.started', 'agent.completed']);
    expect(metrics.increment).toHaveBeenCalledWith('token_usage', 150);
    expect(metrics.observe).toHaveBeenCalledWith('agent_duration', 25);
  });

  it('retries retryable failures up to maxAttempts', async () => {
    const { engine, executor, metrics, sleep } = buildHarness();
    (executor.execute as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(agentResult());
    const stepWithRetries: AgentWorkflowStep = { ...step, maxAttempts: 2 };
    const result = await engine.executeAgentStep(stepWithRetries, context({ defaultMaxAttempts: 2 }));
    expect(result.executions).toHaveLength(2);
    expect(result.executions[1]?.status).toBe('COMPLETED');
    expect(metrics.increment).toHaveBeenCalledWith('retry_count');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does not retry validation failures', async () => {
    const { engine, executor, sleep } = buildHarness();
    (executor.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ValidationFailedError('invalid', {}),
    );
    const stepWithRetries: AgentWorkflowStep = { ...step, maxAttempts: 3 };
    await expect(
      engine.executeAgentStep(stepWithRetries, context({ defaultMaxAttempts: 3 })),
    ).rejects.toBeInstanceOf(ValidationFailedError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws the final error after exhausting retries', async () => {
    const { engine, executor, metrics } = buildHarness();
    (executor.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('always'));
    const stepWithRetries: AgentWorkflowStep = { ...step, maxAttempts: 2 };
    await expect(
      engine.executeAgentStep(stepWithRetries, context({ defaultMaxAttempts: 2 })),
    ).rejects.toThrow('always');
    expect(metrics.increment).toHaveBeenCalledWith('agent_failures');
  });

  it('wraps non-Error rejections in OrchestratorError', async () => {
    const { engine, executor } = buildHarness();
    (executor.execute as ReturnType<typeof vi.fn>).mockRejectedValue('oops');
    await expect(engine.executeAgentStep(step, context())).rejects.toBeInstanceOf(
      OrchestratorError,
    );
  });

  it('enforces per-step timeouts', async () => {
    const { engine, executor } = buildHarness();
    (executor.execute as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => undefined),
    );
    const timeoutStep: AgentWorkflowStep = { ...step, timeoutMs: 5 };
    await expect(engine.executeAgentStep(timeoutStep, context())).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  it('aborts before executing when the signal is already aborted', async () => {
    const { engine, executor } = buildHarness();
    const controller = new AbortController();
    controller.abort();
    await expect(
      engine.executeAgentStep(step, context({ signal: controller.signal })),
    ).rejects.toBeInstanceOf(CancelledError);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('cancels when the signal aborts during execution', async () => {
    const harness = buildHarness();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    (harness.executor.execute as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    await expect(
      harness.engine.executeAgentStep(step, context({ signal: controller.signal })),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it('rates-limits step starts when configured', async () => {
    const { engine, executor, sleep } = buildHarness({ maxRatePerSecond: 1000 });
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue(agentResult());
    await engine.executeAgentStep(step, context());
    await engine.executeAgentStep(step, context());
    expect(sleep).toHaveBeenCalled();
  });

  it('uses the default sleep and clock', async () => {
    const executor: AgentExecutor = { execute: vi.fn(async () => agentResult()) };
    const engine = new ExecutionEngine({ executor });
    const result = await engine.executeAgentStep(step, context());
    expect(result.result.data).toEqual(agentResult().data);
  });

  it('defaults unknown provider and model in execution records', async () => {
    const { engine, executor } = buildHarness();
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue(agentResult());
    const ctx = context({
      buildTask: async () => ({ ...agentTask(), provider: undefined, model: undefined }),
    });
    const result = await engine.executeAgentStep(step, ctx);
    expect(result.executions[0]?.provider).toBe('unknown');
    expect(result.executions[0]?.model).toBe('unknown');
  });

  it('throws when maxAttempts is zero', async () => {
    const { engine, executor } = buildHarness();
    (executor.execute as ReturnType<typeof vi.fn>).mockResolvedValue(agentResult());
    const zeroAttempts: AgentWorkflowStep = { ...step, maxAttempts: 0 };
    await expect(engine.executeAgentStep(zeroAttempts, context())).rejects.toBeInstanceOf(
      OrchestratorError,
    );
    expect(executor.execute).not.toHaveBeenCalled();
  });
});

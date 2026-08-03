import { describe, expect, it, vi } from 'vitest';
import type { MetricsRegistry } from '@seogod/monitoring';
import type { Logger } from '@seogod/logging';
import type { EventSink } from '../types/events.js';
import type { AgentResult } from '../types/agent.js';
import type { AgentExecutor } from '../execution/agent-runner.js';
import { ExecutionEngine } from '../execution/execution-engine.js';
import {
  WorkflowEngine,
  validateDefinition,
  type AgentTaskFactory,
} from './workflow-engine.js';
import type { WorkflowDefinition, AgentWorkflowStep } from '../types/workflow.js';
import { agentResult, agentTask, promptContext, workflowDefinition } from '../test/fixtures.js';

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

function agentStep(id: string): AgentWorkflowStep {
  return { id, kind: 'agent', agentId: 'title-writer', taskTemplate: 'do it' };
}

interface Harness {
  engine: WorkflowEngine;
  executor: AgentExecutor;
  events: EventSink;
  metrics: ReturnType<typeof metricsSpy>;
  onCheckpoint: ReturnType<typeof vi.fn>;
  now: () => Date;
}

function buildEngine(result: Partial<AgentResult> = {}): Harness {
  const executor: AgentExecutor = {
    execute: vi.fn(async (task) =>
      agentResult({
        taskId: task.id,
        stepId: task.stepId,
        data: { count: 5, status: 'ready', name: 'alpha', tags: ['a', 'b'] },
        ...result,
      }),
    ),
  };
  const events: EventSink = { emit: vi.fn() };
  const metrics = metricsSpy();
  const logger = loggerSpy();
  const onCheckpoint = vi.fn(async () => undefined);
  const now = () => new Date('2026-01-01T00:00:00Z');
  const sleep = vi.fn(async () => undefined);
  const taskFactory: AgentTaskFactory = {
    build: async (step, workflow) =>
      agentTask({
        stepId: step.id,
        workflowId: workflow.id,
        context: promptContext({ storeId: workflow.storeId }),
      }),
  };
  const executionEngine = new ExecutionEngine({
    executor,
    sleep,
    now,
    eventSink: events,
    metrics,
    logger,
  });
  const engine = new WorkflowEngine({
    executionEngine,
    taskFactory,
    now,
    eventSink: events,
    metrics,
    logger,
    onCheckpoint,
    defaultMaxAttempts: 1,
    defaultTimeoutMs: 0,
  });
  return { engine, executor, events, metrics, onCheckpoint, now };
}

function run(
  harness: Harness,
  definition: WorkflowDefinition,
  inputs: Record<string, unknown> = {},
  options: Parameters<WorkflowEngine['run']>[2] = {},
) {
  return harness.engine.run(definition, inputs, options);
}

describe('WorkflowEngine', () => {
  it('runs a sequential workflow to completion', async () => {
    const harness = buildEngine();
    const definition = workflowDefinition({
      steps: [agentStep('s1'), agentStep('s2')],
    });
    const result = await run(harness, definition);
    expect(result.execution.status).toBe('COMPLETED');
    expect(Object.keys(result.execution.outputs)).toEqual(['s1', 's2']);
    expect(result.report.status).toBe('COMPLETED');
    expect(result.trace.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['workflow.started', 'workflow.completed', 'step.completed']),
    );
    expect(harness.metrics.increment).toHaveBeenCalledWith('workflow_count');
    expect(harness.metrics.observe).toHaveBeenCalledWith('workflow_duration', expect.any(Number));
  });

  it('runs parallel groups with bounded concurrency', async () => {
    const harness = buildEngine();
    const definition = workflowDefinition({
      steps: [
        { id: 'group', kind: 'parallel', steps: [agentStep('p1'), agentStep('p2'), agentStep('p3')], maxConcurrency: 2 },
      ],
    });
    const result = await run(harness, definition);
    expect(result.execution.status).toBe('COMPLETED');
    expect(Object.keys(result.execution.outputs).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('schedules steps by dependency edges', async () => {
    const harness = buildEngine();
    const ordered = workflowDefinition({
      steps: [
        { ...agentStep('b'), dependsOn: ['a'] },
        agentStep('a'),
      ],
    });
    const result = await run(harness, ordered);
    expect(result.execution.status).toBe('COMPLETED');
    const order = (harness.executor.execute as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { stepId: string }).stepId,
    );
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  });

  it('runs conditional branches against prior outputs', async () => {
    const harness = buildEngine();
    const steps = [
      agentStep('base'),
      { id: 'c1', kind: 'conditional' as const, condition: { key: 'steps.base.data.count', operator: 'gt' as const, value: 3 }, whenTrue: [agentStep('gt-yes')], whenFalse: [agentStep('gt-no')] },
      { id: 'c2', kind: 'conditional' as const, condition: { key: 'steps.base.data.status', operator: 'eq' as const, value: 'ready' }, whenTrue: [agentStep('eq-yes')], whenFalse: [agentStep('eq-no')] },
      { id: 'c3', kind: 'conditional' as const, condition: { key: 'steps.base.data.status', operator: 'eq' as const, value: 'nope' }, whenTrue: [agentStep('eq2-yes')], whenFalse: [agentStep('eq2-no')] },
      { id: 'c4', kind: 'conditional' as const, condition: { key: 'steps.base.data.name', operator: 'contains' as const, value: 'pha' }, whenTrue: [agentStep('contains-yes')], whenFalse: [agentStep('contains-no')] },
      { id: 'c5', kind: 'conditional' as const, condition: { key: 'steps.base.data.missing', operator: 'not_exists' as const }, whenTrue: [agentStep('missing-yes')], whenFalse: [agentStep('missing-no')] },
      { id: 'c6', kind: 'conditional' as const, condition: { key: 'steps.base.data.count', operator: 'lt' as const, value: 10 }, whenTrue: [agentStep('lt-yes')], whenFalse: [agentStep('lt-no')] },
      { id: 'c7', kind: 'conditional' as const, condition: { key: 'steps.base.data.status', operator: 'ne' as const, value: 'no' }, whenTrue: [agentStep('ne-yes')], whenFalse: [agentStep('ne-no')] },
      { id: 'c8', kind: 'conditional' as const, condition: { key: 'steps.base.data.status', operator: 'exists' as const }, whenTrue: [agentStep('exists-yes')], whenFalse: [agentStep('exists-no')] },
    ];
    const result = await run(harness, workflowDefinition({ steps }));
    expect(result.execution.status).toBe('COMPLETED');
    expect(Object.keys(result.execution.outputs)).toEqual(
      expect.arrayContaining(['gt-yes', 'eq-yes', 'eq2-no', 'contains-yes', 'missing-yes', 'lt-yes', 'ne-yes', 'exists-yes']),
    );
    const branches = result.execution.steps
      .filter((s) => s.stepId.startsWith('c'))
      .map((s) => ({ id: s.stepId, branch: s.branchTaken }));
    expect(branches.find((b) => b.id === 'c1')?.branch).toBe(true);
    expect(branches.find((b) => b.id === 'c3')?.branch).toBe(false);
  });

  it('marks remaining steps skipped when a step fails', async () => {
    const harness = buildEngine();
    (harness.executor.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    );
    const definition = workflowDefinition({ steps: [agentStep('ok'), agentStep('bad')] });
    const result = await run(harness, definition);
    expect(result.execution.status).toBe('FAILED');
    expect(result.execution.error).toBe('boom');
    expect(result.report.steps).toEqual(expect.objectContaining({ skipped: 1, failed: 1 }));
    const types = (harness.events.emit as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0].type);
    expect(types).toContain('workflow.failed');
  });

  it('cancels when the signal aborts', async () => {
    const harness = buildEngine();
    (harness.executor.execute as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    const controller = new AbortController();
    const runPromise = run(harness, workflowDefinition({ steps: [agentStep('s1')] }), {}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    const result = await runPromise;
    expect(result.execution.status).toBe('CANCELLED');
    expect(result.execution.cancelledAt).not.toBeNull();
  });

  it('times out an overall workflow budget', async () => {
    const harness = buildEngine();
    (harness.executor.execute as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    const definition = workflowDefinition({ timeoutMs: 20, steps: [agentStep('s1')] });
    const result = await run(harness, definition);
    expect(result.execution.status).toBe('TIMED_OUT');
    expect(result.execution.error).toContain('time budget');
  });

  it('checkpoints after each top-level step', async () => {
    const harness = buildEngine();
    const result = await run(harness, workflowDefinition({ steps: [agentStep('s1'), agentStep('s2')] }));
    expect(harness.onCheckpoint).toHaveBeenCalled();
    expect(result.execution.checkpointedAt).not.toBeNull();
  });

  it('resumes from a checkpoint and skips completed steps', async () => {
    const harness = buildEngine();
    const definition = workflowDefinition({ steps: [agentStep('s1'), agentStep('s2')] });
    const first = await run(harness, definition, { x: 1 });
    const callsAfterFirst = (harness.executor.execute as ReturnType<typeof vi.fn>).mock.calls.length;
    const second = await run(harness, definition, { x: 1 }, { startFrom: first.execution });
    expect(second.execution.status).toBe('COMPLETED');
    expect((harness.executor.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsAfterFirst,
    );
    const resumed = second.trace.events.filter((e) => e.type === 'step.resumed');
    expect(resumed.length).toBe(2);
  });

  it('runs an empty definition successfully', async () => {
    const harness = buildEngine();
    const result = await run(harness, workflowDefinition());
    expect(result.execution.status).toBe('COMPLETED');
    expect(result.report.steps.total).toBe(0);
  });

  it('rejects cyclic dependency graphs', async () => {
    const harness = buildEngine();
    const definition = workflowDefinition({
      steps: [
        { ...agentStep('a'), dependsOn: ['b'] },
        { ...agentStep('b'), dependsOn: ['a'] },
      ],
    });
    const result = await run(harness, definition);
    expect(result.execution.status).toBe('FAILED');
    expect(result.execution.error).toContain('dependency cycle');
  });

  it('runs nested sequential groups', async () => {
    const harness = buildEngine();
    const definition = workflowDefinition({
      steps: [{ id: 'seq', kind: 'sequential', steps: [agentStep('n1'), agentStep('n2')] }],
    });
    const result = await run(harness, definition);
    expect(result.execution.status).toBe('COMPLETED');
    expect(Object.keys(result.execution.outputs).sort()).toEqual(['n1', 'n2']);
  });

  it('records a non-Error step failure', async () => {
    const harness = buildEngine();
    (harness.executor.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce('boom-string');
    const result = await run(harness, workflowDefinition({ steps: [agentStep('s1')] }));
    expect(result.execution.status).toBe('FAILED');
    expect(result.execution.error).toBe('boom-string');
  });

  it('uses the default clock, defaults, and no event sink when unconfigured', async () => {
    const executor: AgentExecutor = {
      execute: vi.fn(async () => agentResult({ data: { ok: true } })),
    };
    const executionEngine = new ExecutionEngine({ executor });
    const taskFactory: AgentTaskFactory = {
      build: async () => agentTask(),
    };
    const engine = new WorkflowEngine({ executionEngine, taskFactory });
    const result = await engine.run(workflowDefinition({ steps: [agentStep('s1')] }), {}, {});
    expect(result.execution.status).toBe('COMPLETED');
  });

  it('applies a run-level timeout that overrides the definition', async () => {
    const harness = buildEngine();
    (harness.executor.execute as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    const result = await run(
      harness,
      workflowDefinition({ steps: [agentStep('s1')] }),
      {},
      { timeoutMs: 20 },
    );
    expect(result.execution.status).toBe('TIMED_OUT');
  });

  it('uses the engine default max attempts when the definition omits it', async () => {
    const harness = buildEngine();
    const definition = workflowDefinition({ steps: [agentStep('s1')] });
    delete definition.defaultMaxAttempts;
    const result = await run(harness, definition);
    expect(result.execution.status).toBe('COMPLETED');
  });
});

describe('validateDefinition', () => {
  it('accepts a valid definition', () => {
    expect(() => validateDefinition(workflowDefinition({ steps: [agentStep('s1')] }))).not.toThrow();
  });

  it('rejects missing identity and version fields', () => {
    expect(() => validateDefinition(workflowDefinition({ id: '' }))).toThrow(/id/);
    expect(() => validateDefinition(workflowDefinition({ name: '' }))).toThrow(/name/);
    expect(() => validateDefinition(workflowDefinition({ version: 0 }))).toThrow(/version/);
  });

  it('rejects duplicate step ids across nesting', () => {
    const definition = workflowDefinition({
      steps: [
        agentStep('s1'),
        { id: 'seq', kind: 'sequential', steps: [agentStep('s1')] },
      ],
    });
    expect(() => validateDefinition(definition)).toThrow(/duplicates: s1/);
  });

  it('rejects non-array steps', () => {
    const definition = workflowDefinition({ steps: [agentStep('s1')] });
    const malformed = { ...definition, steps: 'nope' as unknown as typeof definition.steps };
    expect(() => validateDefinition(malformed)).toThrow(/steps/);
  });
});

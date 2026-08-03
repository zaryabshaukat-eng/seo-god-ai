import { NotFoundError, ValidationError } from '@seogod/core';
import type { EventBus } from '@seogod/events';
import type { Logger } from '@seogod/logging';
import { describe, expect, it, vi } from 'vitest';
import type { MetricsRegistry } from '@seogod/monitoring';
import { Orchestrator, type OrchestratorOptions, RepositoryMemoryStore } from './orchestrator.js';
import { AgentRegistry } from '../registry/agent-registry.js';
import { DefaultProviderFactory } from '../providers/provider-factory.js';
import type { FetchLike } from '../providers/openai-provider.js';
import { InMemoryOrchestratorRepository } from '../repositories/in-memory-repository.js';
import { WorkflowExecutionModel } from '../models/workflow-execution.js';
import {
  agentDefinition,
  agentTask,
  executionPlan,
  workflowDefinition,
} from '../test/fixtures.js';
import type { AgentWorkflowStep } from '../types/workflow.js';

const okFetch: FetchLike = async () => ({
  ok: true,
  status: 200,
  text: async () =>
    JSON.stringify({
      choices: [{ message: { content: '{"action":"update_title","resourceId":"/p/1"}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: 'gpt-4o-mini',
    }),
});

interface Harness {
  orchestrator: Orchestrator;
  registry: AgentRegistry;
  repository: InMemoryOrchestratorRepository;
  eventBus: { publish: ReturnType<typeof vi.fn> };
  logger: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
}

function build(options: { fetch?: FetchLike; providers?: DefaultProviderFactory } = {}): Harness {
  const registry = new AgentRegistry();
  registry.register(agentDefinition());
  const providers =
    options.providers ??
    new DefaultProviderFactory([{ name: 'openai', model: 'gpt-4o-mini' }], {
      fetchFn: options.fetch ?? okFetch,
    });
  const repository = new InMemoryOrchestratorRepository();
  const eventBus = { publish: vi.fn(async () => undefined) };
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
  const orchestrator = new Orchestrator({
    registry,
    providers,
    repository,
    eventBus: eventBus as unknown as EventBus,
    logger: logger as unknown as Logger,
    now: () => new Date('2026-01-01T00:00:00Z'),
  });
  return { orchestrator, registry, repository, eventBus, logger };
}

function simpleStep(id = 's1'): AgentWorkflowStep {
  return { id, kind: 'agent', agentId: 'title-writer', taskTemplate: 'do it', timeoutMs: 0 };
}

describe('Orchestrator', () => {
  it('requires a provider factory', () => {
    expect(() => new Orchestrator({} as unknown as OrchestratorOptions)).toThrow(ValidationError);
  });

  it('exposes agent registry operations', () => {
    const { orchestrator, registry } = build();
    expect(orchestrator.listAgents()).toHaveLength(1);
    expect(orchestrator.getAgent('title-writer').name).toBe('Title Writer');
    const updated = orchestrator.updateAgentHealth('title-writer', 'down', 'outage');
    expect(updated.health.status).toBe('down');
    expect(registry.get('title-writer').health.detail).toBe('outage');
    orchestrator.unregisterAgent('title-writer');
    expect(orchestrator.listAgents()).toHaveLength(0);
    expect(() => orchestrator.unregisterAgent('title-writer')).toThrow(NotFoundError);
  });

  it('plans and persists a workflow definition', async () => {
    const { orchestrator, repository } = build();
    const workflow = orchestrator.planWorkflow(executionPlan());
    expect(workflow.definition.steps.length).toBeGreaterThan(0);
    expect(await repository.getWorkflowDefinition(workflow.definition.id)).not.toBeNull();
  });

  it('runs a planned workflow to completion with events and persistence', async () => {
    const { orchestrator, repository, eventBus } = build();
    const workflow = orchestrator.planWorkflow(executionPlan());
    const result = await orchestrator.startWorkflow(workflow, {
      inputs: {},
      contextSources: { storeMetadata: { name: 'Acme' } },
    });
    expect(result.execution.status).toBe('COMPLETED');
    expect(await repository.getExecution(result.execution.id)).not.toBeNull();
    expect(await repository.getTrace(result.execution.id)).not.toBeNull();
    expect(await repository.queryMemory({ kind: 'execution' })).toHaveLength(1);
    const types = eventBus.publish.mock.calls.map((call) => call[0].type);
    expect(types).toEqual(
      expect.arrayContaining(['workflow.started', 'workflow.completed', 'agent.started', 'agent.completed']),
    );
  });

  it('runs a raw workflow definition directly', async () => {
    const { orchestrator } = build();
    const definition = workflowDefinition({ steps: [simpleStep()] });
    const result = await orchestrator.startWorkflow(definition, { storeId: 'store-1', inputs: {} });
    expect(result.execution.status).toBe('COMPLETED');
    expect(result.report.totalTokens).toBe(15);
  });

  it('refuses to start the same workflow while it is already running', async () => {
    const { orchestrator, eventBus } = build({ fetch: async () => new Promise(() => undefined) as never });
    const definition = workflowDefinition({ steps: [simpleStep()] });
    const first = orchestrator.startWorkflow(definition, { storeId: 'store-1', inputs: {} });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(
      orchestrator.startWorkflow(definition, { storeId: 'store-1', inputs: {} }),
    ).rejects.toBeInstanceOf(ValidationError);
    orchestrator.cancelWorkflow(WorkflowExecutionModel.idFor(definition.id, 'store-1'));
    const result = await first;
    expect(result.execution.status).toBe('CANCELLED');
    expect(eventBus.publish.mock.calls.map((call) => call[0].type)).toContain('workflow.failed');
  });

  it('cancels running workflows and rejects unknown ids', async () => {
    const { orchestrator } = build();
    const definition = workflowDefinition({ steps: [simpleStep()] });
    const run = orchestrator.startWorkflow(definition, { storeId: 'store-1', inputs: {} });
    const executionId = WorkflowExecutionModel.idFor(definition.id, 'store-1');
    expect(() => orchestrator.cancelWorkflow('missing')).toThrow(NotFoundError);
    orchestrator.cancelWorkflow(executionId);
    const result = await run;
    expect(result.execution.status).toBe('CANCELLED');
  });

  it('recovers a workflow from its checkpoint', async () => {
    const { orchestrator } = build();
    const definition = workflowDefinition({ steps: [simpleStep('s1'), simpleStep('s2')] });
    const first = await orchestrator.startWorkflow(definition, { storeId: 'store-1', inputs: {} });
    expect(first.execution.status).toBe('COMPLETED');

    await expect(orchestrator.recoverWorkflow('missing')).rejects.toBeInstanceOf(NotFoundError);
    const recovered = await orchestrator.recoverWorkflow(first.execution.id);
    expect(recovered.execution.status).toBe('COMPLETED');
    expect(recovered.execution.id).toBe(first.execution.id);
  });

  it('runs a single agent task directly', async () => {
    const { orchestrator, eventBus } = build();
    const result = await orchestrator.runAgentTask(agentTask());
    expect(result.agentId).toBe('title-writer');
    expect(result.data).toEqual({ action: 'update_title', resourceId: '/p/1' });
    const types = eventBus.publish.mock.calls.map((call) => call[0].type);
    expect(types).toContain('agent.completed');
  });

  it('runs without an event bus, metrics, or logger', async () => {
    const registry = new AgentRegistry();
    registry.register(agentDefinition());
    const providers = new DefaultProviderFactory([{ name: 'openai', model: 'gpt-4o-mini' }], {
      fetchFn: okFetch,
    });
    const orchestrator = new Orchestrator({
      registry,
      providers,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    const result = await orchestrator.startWorkflow(
      workflowDefinition({ steps: [simpleStep()] }),
      { storeId: 'store-1', inputs: {} },
    );
    expect(result.execution.status).toBe('COMPLETED');
  });

  it('emits metrics for direct agent tasks', async () => {
    const metrics = {
      increment: vi.fn(),
      observe: vi.fn(),
      setGauge: vi.fn(),
    } as unknown as MetricsRegistry;
    const registry = new AgentRegistry();
    registry.register(agentDefinition());
    const providers = new DefaultProviderFactory([{ name: 'openai', model: 'gpt-4o-mini' }], {
      fetchFn: okFetch,
    });
    const orchestrator = new Orchestrator({
      registry,
      providers,
      metrics,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    const result = await orchestrator.runAgentTask(agentTask());
    expect(result.data).toEqual({ action: 'update_title', resourceId: '/p/1' });
    expect(metrics.increment).toHaveBeenCalledWith('token_usage', 15);
    expect(metrics.observe).toHaveBeenCalledWith('agent_duration', expect.any(Number));
  });

  it('fails recovery when the workflow definition is missing', async () => {
    const { orchestrator, repository } = build();
    const execution = WorkflowExecutionModel.create({
      definition: workflowDefinition({ id: 'orphan' }),
      storeId: 'store-1',
      inputs: {},
    });
    await repository.saveCheckpoint(execution);
    await expect(orchestrator.recoverWorkflow(execution.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emits agent.failed when a direct task fails', async () => {
    const { orchestrator, eventBus } = build();
    const task = agentTask({ expectedSchema: { type: 'object', required: ['nope'] } });
    await expect(orchestrator.runAgentTask(task)).rejects.toThrow();
    const failed = eventBus.publish.mock.calls.find((call) => call[0].type === 'agent.failed');
    expect(failed?.[0].payload).toMatchObject({ agentId: 'title-writer', retryable: false });
  });

  it('reads execution, trace, and report after a run', async () => {
    const { orchestrator } = build();
    const definition = workflowDefinition({ steps: [simpleStep()] });
    const result = await orchestrator.startWorkflow(definition, { storeId: 'store-1', inputs: {} });
    expect(await orchestrator.getExecution(result.execution.id)).not.toBeNull();
    expect(await orchestrator.getTrace(result.execution.id)).not.toBeNull();
    const report = await orchestrator.getReport(result.execution.id);
    expect(report.status).toBe('COMPLETED');
    await expect(orchestrator.getReport('missing')).rejects.toBeInstanceOf(NotFoundError);
    expect(await orchestrator.queryMemory({ kind: 'execution' })).toHaveLength(1);
  });

  it('swallows event-bus failures without failing the workflow', async () => {
    const { orchestrator, eventBus, logger } = build();
    eventBus.publish.mockRejectedValue(new Error('bus down'));
    const result = await orchestrator.startWorkflow(
      workflowDefinition({ steps: [simpleStep()] }),
      { storeId: 'store-1', inputs: {} },
    );
    expect(result.execution.status).toBe('COMPLETED');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.stringContaining('workflow.') }),
      'failed to publish orchestrator event',
    );
  });

  it('registers agents through the facade', () => {
    const { orchestrator, registry } = build();
    const registered = orchestrator.registerAgent(
      agentDefinition({ id: 'meta-writer', name: 'Meta Writer' }),
    );
    expect(registered.id).toBe('meta-writer');
    expect(registry.get('meta-writer').name).toBe('Meta Writer');
  });

  it('updates agent health without a detail message', () => {
    const { orchestrator } = build();
    const updated = orchestrator.updateAgentHealth('title-writer', 'degraded');
    expect(updated.health.status).toBe('degraded');
    expect(updated.health.detail).toBeUndefined();
  });

  it('falls back to default components and registers agents', async () => {
    const providers = new DefaultProviderFactory([{ name: 'openai', model: 'gpt-4o-mini' }], {
      fetchFn: okFetch,
    });
    const orchestrator = new Orchestrator({ providers });
    const registered = orchestrator.registerAgent(agentDefinition());
    expect(registered.id).toBe('title-writer');
    const workflow = orchestrator.planWorkflow(executionPlan());
    expect(workflow.definition.steps.length).toBeGreaterThan(0);
    const result = await orchestrator.startWorkflow(
      workflowDefinition({ steps: [simpleStep()] }),
      { storeId: 'store-1', inputs: {} },
    );
    expect(result.execution.status).toBe('COMPLETED');
  });

  it('falls back to the workflow store id when none is provided', async () => {
    const { orchestrator, repository } = build();
    const workflow = orchestrator.planWorkflow(executionPlan());
    const result = await orchestrator.startWorkflow(workflow, { inputs: {} });
    expect(result.execution.storeId).toBe(workflow.source.storeId);
    expect(
      await repository.queryMemory({ storeId: workflow.source.storeId, kind: 'execution' }),
    ).toHaveLength(1);
  });

  it('aborts before starting when the signal is already cancelled', async () => {
    const { orchestrator, eventBus } = build();
    const controller = new AbortController();
    controller.abort();
    const result = await orchestrator.startWorkflow(
      workflowDefinition({ steps: [simpleStep()] }),
      { storeId: 'store-1', inputs: {}, signal: controller.signal },
    );
    expect(result.execution.status).toBe('CANCELLED');
    expect(eventBus.publish.mock.calls.map((call) => call[0].type)).toContain('workflow.failed');
  });

  it('aborts when the signal fires during a run', async () => {
    const { orchestrator } = build({ fetch: async () => new Promise(() => undefined) as never });
    const controller = new AbortController();
    const run = orchestrator.startWorkflow(
      workflowDefinition({ steps: [simpleStep()] }),
      { storeId: 'store-1', inputs: {}, signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 5);
    const result = await run;
    expect(result.execution.status).toBe('CANCELLED');
  });

  it('emits failure metrics when a direct task fails', async () => {
    const metrics = {
      increment: vi.fn(),
      observe: vi.fn(),
      setGauge: vi.fn(),
    } as unknown as MetricsRegistry;
    const registry = new AgentRegistry();
    registry.register(agentDefinition());
    const providers = new DefaultProviderFactory([{ name: 'openai', model: 'gpt-4o-mini' }], {
      fetchFn: okFetch,
    });
    const orchestrator = new Orchestrator({
      registry,
      providers,
      metrics,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    const task = agentTask({ expectedSchema: { type: 'object', required: ['nope'] } });
    await expect(orchestrator.runAgentTask(task)).rejects.toThrow();
    expect(metrics.increment).toHaveBeenCalledWith('agent_failures');
  });

  it('repository memory store adds, queries, and reads latest entries', async () => {
    const repository = new InMemoryOrchestratorRepository();
    const memory = new RepositoryMemoryStore(repository);
    const added = await memory.add(
      {
        storeId: 'store-1',
        workflowId: 'workflow-1',
        kind: 'execution',
        key: 'workflow:def',
        data: { status: 'COMPLETED' },
      },
      () => new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(added.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(await memory.query({ storeId: 'store-1', kind: 'execution', key: 'workflow:def' })).toHaveLength(1);
    expect(await memory.latest('store-1', 'execution', 'workflow:def')).not.toBeNull();
    expect(await memory.latest('store-1', 'execution', 'missing')).toBeNull();
  });
});

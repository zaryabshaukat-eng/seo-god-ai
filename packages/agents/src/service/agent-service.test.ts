import { ValidationError } from '@seogod/core';
import type { EventBus } from '@seogod/events';
import type { Logger } from '@seogod/logging';
import { MetricsRegistry } from '@seogod/monitoring';
import { describe, expect, it } from 'vitest';
import { AgentMemory } from '../memory/agent-memory.js';
import { AgentService } from './agent-service.js';
import { InMemoryAgentRepository } from '../repositories/agent-repository.js';
import { SafetyViolationError } from '../utils/errors.js';
import { makeEntity, makeInput, makeResult, StubAgent } from '../test/helpers.js';
import type { AgentInput } from '../types/input.js';
import type { AgentActionType } from '../types/output.js';

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

interface Harness {
  service: AgentService;
  repo: InMemoryAgentRepository;
  memory: AgentMemory;
  metrics: MetricsRegistry;
  published: Array<{ type: string; aggregateType?: string; aggregateId?: string; payload: unknown }>;
  logs: Array<{ level: string; message: string }>;
}

function buildHarness(overrides: Partial<ConstructorParameters<typeof AgentService>[0]> = {}): Harness {
  const repo = new InMemoryAgentRepository();
  const memory = new AgentMemory(repo, () => FIXED_NOW);
  const metrics = new MetricsRegistry();
  const published: Harness['published'] = [];
  const logs: Harness['logs'] = [];
  const eventBus = {
    publish: async (input: { type: string; aggregateType?: string; aggregateId?: string; payload: unknown }) => {
      published.push(input);
      return input as never;
    },
  } as unknown as EventBus;
  const logger = {
    info: (fields: object, message: string) => logs.push({ level: 'info', message }),
    error: (fields: object, message: string) => logs.push({ level: 'error', message }),
  } as unknown as Logger;

  const service = new AgentService({
    repository: repo,
    memory,
    metrics,
    eventBus,
    logger,
    now: () => FIXED_NOW,
    costPer1kTokens: 0.002,
    ...overrides,
  });
  return { service, repo, memory, metrics, published, logs };
}

/** An agent that returns a fully valid result with a recommendation and a safe action. */
function validAgent(): StubAgent {
  return new StubAgent('metadata', (input: AgentInput) =>
    makeResult('metadata', input.taskId, {
      recommendations: [
        {
          rule: 'metadata.missing-title',
          title: 'Missing title',
          summary: 's',
          reason: 'r',
          evidence: [],
          severity: 'MEDIUM',
          confidence: 0.8,
          estimatedImpact: 40,
          risk: 'LOW',
          implementationDifficulty: 'TRIVIAL',
          expectedExecutionTime: '5 minutes',
          rollbackPossible: true,
          approvalRequired: false,
          affectedUrls: [input.entities[0]?.ref ?? ''],
        },
      ],
      actions: [
        {
          actionType: 'update_title',
          resourceType: 'page',
          resourceId: input.entities[0]?.id ?? '',
          resourceRef: input.entities[0]?.ref ?? '',
          payload: { title: 'New title' },
          priority: 50,
          estimatedSeconds: 600,
          rationale: 'Draft title',
        },
      ],
    }),
  );
}

function validInput(): AgentInput {
  return makeInput({
    entities: [makeEntity({ id: 'entity-1', data: { title: 'Acme' } })],
    settings: { locale: 'en' },
  });
}

describe('AgentService', () => {
  it('registers agents and exposes definitions', () => {
    const { service } = buildHarness();
    const definition = service.register(validAgent());
    expect(definition.id).toBe('metadata');
    expect(service.hasAgent('metadata')).toBe(true);
    expect(service.getAgent('metadata').name).toBe('metadata');
    expect(service.listAgents().map((entry) => entry.id)).toContain('metadata');
    service.unregister('metadata');
    expect(service.hasAgent('metadata')).toBe(false);
  });

  it('emits an agent.registered event on registration', () => {
    const { service, published } = buildHarness();
    service.register(validAgent());
    expect(published.map((event) => event.type)).toContain('agent.registered');
    const event = published.find((entry) => entry.type === 'agent.registered');
    expect(event?.aggregateType).toBe('agent');
    expect(event?.aggregateId).toBe('metadata');
  });

  it('invokes an agent end to end and records runs, memory, metrics and events', async () => {
    const { service, repo, metrics, published } = buildHarness();
    service.register(validAgent());
    const out = await service.invoke('metadata', validInput(), { model: 'gpt-4' });

    expect(out.model).toBe('gpt-4');
    expect(out.result.agentId).toBe('metadata');
    expect(out.context.tokenEstimate).toBeGreaterThan(0);

    const run = await repo.getRun(out.run.id);
    expect(run?.taskId).toBe('task-1');
    expect(run?.recommendationCount).toBe(1);
    expect(run?.actionCount).toBe(1);
    expect(run?.model).toBe('gpt-4');

    const types = published.map((event) => event.type);
    expect(types).toContain('agent.invoked');
    expect(types).toContain('agent.completed');
    expect(types).toContain('recommendation.generated');
    expect(types).toContain('agent.registered');

    expect(metrics.snapshot().counters['agent_runs']).toBe(1);
    expect(metrics.snapshot().counters['token_usage']).toBe(out.context.tokenEstimate);
    expect(metrics.snapshot().histograms['agent_duration']?.count).toBe(1);
    expect(metrics.snapshot().gauges['average_confidence']).toBeCloseTo(0.9);
    expect(metrics.snapshot().gauges['average_tokens']).toBeGreaterThan(0);
    expect(metrics.snapshot().gauges['estimated_cost']).toBeGreaterThan(0);

    const history = await service.queryMemory({ storeId: 'store-1' });
    const kinds = history.map((entry) => entry.kind);
    expect(kinds).toContain('agent_history');
    expect(kinds).toContain('execution');
    expect(kinds).toContain('performance');
  });

  it('returns a run and performance snapshot via repository reads', async () => {
    const { service } = buildHarness();
    service.register(validAgent());
    await service.invoke('metadata', validInput());
    const runs = await service.listRuns({ storeId: 'store-1' });
    expect(runs).toHaveLength(1);
    expect(await service.getRun(runs[0]!.id)).not.toBeNull();
    const snapshot = await service.performanceSnapshot('store-1', 'metadata');
    expect(snapshot.runs).toBe(1);
  });

  it('throws a ValidationError for invalid input and records the failure', async () => {
    const { service, published, metrics } = buildHarness();
    service.register(validAgent());
    const bad = makeInput({ storeId: '' });
    await expect(service.invoke('metadata', bad)).rejects.toBeInstanceOf(ValidationError);
    const failed = published.find((event) => event.type === 'agent.failed');
    expect(failed?.payload).toMatchObject({ error: 'input validation failed' });
    expect(metrics.snapshot().counters['validation_failures']).toBeGreaterThan(0);
    expect(metrics.snapshot().counters['agent_failures']).toBe(1);
  });

  it('throws a ValidationError for invalid output and rejects recommendations', async () => {
    const { service, published } = buildHarness();
    const broken = new StubAgent('metadata', (input: AgentInput) =>
      makeResult('wrong-agent', input.taskId, {
        recommendations: [
          {
            rule: 'metadata.missing-title',
            title: 't',
            summary: 's',
            reason: 'r',
            evidence: [],
            severity: 'MEDIUM',
            confidence: 0.8,
            estimatedImpact: 40,
            risk: 'LOW',
            implementationDifficulty: 'TRIVIAL',
            expectedExecutionTime: '5 minutes',
            rollbackPossible: true,
            approvalRequired: false,
            affectedUrls: [],
          },
        ],
      }),
    );
    service.register(broken);
    await expect(service.invoke('metadata', validInput())).rejects.toBeInstanceOf(ValidationError);
    expect(published.map((event) => event.type)).toContain('recommendation.rejected');
    expect(published.map((event) => event.type)).toContain('agent.failed');
  });

  it('rethrows SafetyViolationError and records a safety output failure', async () => {
    const { service, published } = buildHarness();
    class UnsafeAgent extends StubAgent {
      override readonly supportedActionTypes: AgentActionType[] = ['delete_page'];
      constructor() {
        super('metadata', (input: AgentInput) =>
          makeResult('metadata', input.taskId, {
            actions: [
              {
                actionType: 'delete_page',
                resourceType: 'page',
                resourceId: input.entities[0]?.id ?? '',
                resourceRef: input.entities[0]?.ref ?? '',
                payload: {},
                priority: 10,
                estimatedSeconds: 1,
                rationale: 'x',
              },
            ],
          }),
        );
      }
    }
    service.register(new UnsafeAgent());
    await expect(service.invoke('metadata', validInput())).rejects.toBeInstanceOf(
      SafetyViolationError,
    );
    expect(published.map((event) => event.type)).toContain('agent.failed');
  });

  it('records an unexpected failure when analyze throws', async () => {
    const { service, repo, logs } = buildHarness();
    const throwing = new StubAgent('metadata', () => {
      throw new Error('kaboom');
    });
    service.register(throwing);
    await expect(service.invoke('metadata', validInput())).rejects.toThrow('kaboom');
    const runs = await repo.listRuns({ storeId: 'store-1' });
    expect(runs[0]?.status).toBe('FAILED');
    expect(runs[0]?.error).toBe('kaboom');
    expect(logs.map((entry) => entry.level)).toContain('error');
  });

  it('records non-Error failures with a stringified message', async () => {
    const { service, repo } = buildHarness();
    const throwing = new StubAgent('metadata', () => {
      throw 'boom';
    });
    service.register(throwing);
    await expect(service.invoke('metadata', validInput())).rejects.toBe('boom');
    const runs = await repo.listRuns({ storeId: 'store-1' });
    expect(runs[0]?.error).toBe('boom');
  });

  it('forwards non-safety errors thrown by the guard', async () => {
    const broken = new StubAgent('metadata', () => makeResult('metadata', 'task-1'));
    const guard = {
      assertSafeResult: () => {
        throw new Error('guard exploded');
      },
    };
    const serviceWithGuard = new AgentService({
      repository: new InMemoryAgentRepository(),
      memory: new AgentMemory(new InMemoryAgentRepository(), () => FIXED_NOW),
      safety: guard as never,
      now: () => FIXED_NOW,
    });
    serviceWithGuard.register(broken);
    await expect(serviceWithGuard.invoke('metadata', validInput())).rejects.toThrow(
      'guard exploded',
    );
  });

  it('rejects recommendations and records feedback', async () => {
    const { service, published, repo } = buildHarness();
    service.register(validAgent());
    await service.rejectRecommendation({
      storeId: 'store-1',
      agentId: 'metadata',
      taskId: 'task-1',
      workflowId: 'w1',
      rule: 'metadata.x',
      reason: 'no',
    });
    expect(published.map((event) => event.type)).toContain('recommendation.rejected');
    expect(await repo.listValidationFailures()).toHaveLength(1);

    const feedback = await service.recordFeedback({
      storeId: 'store-1',
      agentId: 'metadata',
      taskId: 'task-1',
      rating: 5,
      comment: 'good',
    });
    expect(feedback.rating).toBe(5);
    expect(await repo.listFeedback()).toHaveLength(1);
  });

  it('rejects recommendations without a workflow id', async () => {
    const { service, published } = buildHarness();
    service.register(validAgent());
    await service.rejectRecommendation({
      storeId: 'store-1',
      agentId: 'metadata',
      taskId: 'task-1',
      rule: 'metadata.x',
      reason: 'no',
    });
    const rejected = published.find((event) => event.type === 'recommendation.rejected');
    expect(rejected?.payload).toMatchObject({ workflowId: '' });
  });

  it('renders a versioned prompt for an agent', () => {
    const { service } = buildHarness();
    service.register(validAgent());
    const prompt = service.renderPrompt('metadata', validInput());
    expect(prompt).toContain('Store: store-1');
    expect(prompt).toContain('Allowed actions: update_title');
    expect(prompt).toContain('Entities:');
  });

  it('renders a prompt with minimal and context-bearing input', () => {
    const { service } = buildHarness();
    service.register(validAgent());
    const bare = service.renderPrompt('metadata', makeInput());
    expect(bare).toContain('Store: store-1');
    const withContext = service.renderPrompt(
      'metadata',
      makeInput({ settings: undefined, context: { outcomes: [] } }),
    );
    expect(withContext).toContain('"outcomes"');
  });

  it('defaults clock, cost model and model when not injected', async () => {
    const service = new AgentService({});
    service.register(validAgent());
    const out = await service.invoke('metadata', validInput());
    expect(out.model).toBe('local-deterministic');
  });

  it('swallows event bus publish failures and logs them', async () => {
    const eventBus = {
      publish: async () => {
        throw new Error('db down');
      },
    } as unknown as EventBus;
    const service2 = new AgentService({
      eventBus,
      now: () => FIXED_NOW,
    });
    service2.register(validAgent());
    await expect(service2.invoke('metadata', validInput())).resolves.toBeTruthy();
  });

  it('logs event bus publish failures when a logger is present', async () => {
    const eventBus = {
      publish: async () => {
        throw new Error('db down');
      },
    } as unknown as EventBus;
    const logs: Harness['logs'] = [];
    const logger = {
      info: () => {},
      error: (fields: object, message: string) => logs.push({ level: 'error', message }),
    } as unknown as Logger;
    const service = new AgentService({ eventBus, logger, now: () => FIXED_NOW });
    service.register(validAgent());
    await expect(service.invoke('metadata', validInput())).resolves.toBeTruthy();
    expect(logs.map((entry) => entry.message)).toContain('failed to publish agent event');
  });

  it('works with default components when nothing is injected', async () => {
    const service = new AgentService({ now: () => FIXED_NOW });
    service.register(validAgent());
    const out = await service.invoke('metadata', validInput());
    expect(out.result.status).toBe('SUCCESS');
    const run = await service.getRun(out.run.id);
    expect(run?.storeId).toBe('store-1');
  });

  it('uses a default model when none is supplied', async () => {
    const { service, repo } = buildHarness();
    service.register(validAgent());
    const out = await service.invoke('metadata', validInput());
    expect(out.model).toBe('local-deterministic');
    const run = await repo.getRun(out.run.id);
    expect(run?.model).toBe('local-deterministic');
  });

  it('throws for unknown agents on invoke, feedback and rejection', async () => {
    const { service } = buildHarness();
    await expect(service.invoke('ghost', validInput())).rejects.toThrow();
    await expect(
      service.recordFeedback({ storeId: 's', agentId: 'ghost', taskId: 't', rating: 1 }),
    ).rejects.toThrow();
    await expect(
      service.rejectRecommendation({ storeId: 's', agentId: 'ghost', taskId: 't', rule: 'r', reason: 'n' }),
    ).rejects.toThrow();
  });
});

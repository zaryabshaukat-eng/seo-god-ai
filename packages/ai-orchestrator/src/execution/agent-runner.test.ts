import { describe, expect, it, vi } from 'vitest';
import { AgentRunner } from './agent-runner.js';
import type { ProviderFactory } from '../providers/provider-factory.js';
import type { Provider } from '../types/provider.js';
import type { ProviderHealth } from '../types/provider.js';
import type { AgentRegistry } from '../registry/agent-registry.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { EventSink } from '../types/events.js';
import type { PromptBuilder } from '../prompts/prompt-builder.js';
import { PromptBuilder as DefaultPromptBuilder } from '../prompts/prompt-builder.js';
import { ResponseValidator } from '../validation/response-validator.js';
import { SafetyGuard } from '../safety/safety-guard.js';
import { ValidationFailedError, SafetyViolationError } from '../errors.js';
import { AgentRegistry as Registry } from '../registry/agent-registry.js';
import { agentDefinition, agentTask, providerResponse } from '../test/fixtures.js';

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    name: 'openai',
    models: ['gpt-4o-mini'],
    complete: vi.fn(async () => providerResponse()),
    checkHealth: vi.fn(async (): Promise<ProviderHealth> => ({ status: 'ok' })),
    ...overrides,
  };
}

interface Runner {
  runner: AgentRunner;
  registry: AgentRegistry;
  providers: ProviderFactory;
  memory: MemoryStore;
  events: EventSink;
  promptBuilder: PromptBuilder;
  validator: ResponseValidator;
  safety: SafetyGuard;
}

function buildRunner(providerOverrides?: Partial<Provider>): Runner {
  const registry = new Registry();
  registry.register(agentDefinition());
  const providers: ProviderFactory = {
    get: () => provider(providerOverrides),
    list: () => [provider(providerOverrides)],
  };
  const memory: MemoryStore = {
    add: vi.fn(async (entry) => ({ ...entry, id: 'm1', createdAt: new Date() })),
    query: vi.fn(async () => []),
    latest: vi.fn(async () => null),
  };
  const events: EventSink = { emit: vi.fn(), validationFailed: vi.fn() };
  const promptBuilder = new DefaultPromptBuilder();
  const validator = new ResponseValidator();
  const safety = new SafetyGuard();
  const runner = new AgentRunner({
    providers,
    registry,
    promptBuilder,
    validator,
    safety,
    memory,
    eventSink: events,
    now: () => new Date('2026-01-01T00:00:00Z'),
  });
  return { runner, registry, providers, memory, events, promptBuilder, validator, safety };
}

describe('AgentRunner', () => {
  it('executes a task end-to-end and records the outcome', async () => {
    const { runner, memory, events } = buildRunner();
    const result = await runner.execute(agentTask(), { attempt: 1 });
    expect(result.agentId).toBe('title-writer');
    expect(result.data).toEqual({ action: 'update_title', resourceId: '/p/1' });
    expect(result.costEstimate).toBeGreaterThan(0);
    expect(result.tokens.totalTokens).toBe(150);
    const added = memory.add as ReturnType<typeof vi.fn>;
    expect(added.mock.calls.map((call) => (call[0] as { kind: string }).kind)).toContain('agent-output');
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('fails validation and emits a validation-failed event + memory record', async () => {
    const { runner, memory, events } = buildRunner({
      complete: vi.fn(async () => providerResponse({ text: '{"action":"delete_page"}' })),
    });
    await expect(runner.execute(agentTask(), { attempt: 1 })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    expect(events.validationFailed).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'title-writer' }),
    );
    const added = memory.add as ReturnType<typeof vi.fn>;
    expect(added.mock.calls.map((call) => (call[0] as { kind: string }).kind)).toContain('validation');
  });

  it('blocks unsafe actions with a safety violation', async () => {
    const { runner } = buildRunner({
      complete: vi.fn(async () => providerResponse({ text: '{"action":"delete_page","resourceId":"/p/1"}' })),
    });
    const task = agentTask({ expectedSchema: undefined });
    await expect(runner.execute(task, { attempt: 1 })).rejects.toBeInstanceOf(
      SafetyViolationError,
    );
  });

  it('rejects output that parses as a non-object root', async () => {
    const { runner } = buildRunner({
      complete: vi.fn(async () => providerResponse({ text: '[1,2,3]' })),
    });
    await expect(runner.execute(agentTask(), { attempt: 1 })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it('uses the injected validator and safety guard', () => {
    const { validator, safety } = buildRunner();
    expect(validator).toBeInstanceOf(ResponseValidator);
    expect(safety).toBeInstanceOf(SafetyGuard);
  });

  it('uses the default validator, safety guard, and clock', async () => {
    const { providers, registry, promptBuilder } = buildRunner();
    const runner = new AgentRunner({ providers, registry, promptBuilder });
    const result = await runner.execute(agentTask(), { attempt: 1 });
    expect(result.completedAt).toBeInstanceOf(Date);
  });

  it('maps non-object validation data to a null result', async () => {
    const { providers, registry, promptBuilder, memory, events } = buildRunner({
      complete: vi.fn(async () => providerResponse({ text: '[1,2,3]' })),
    });
    const runner = new AgentRunner({
      providers,
      registry,
      promptBuilder,
      validator: new ResponseValidator({ requireObject: false }),
      safety: new SafetyGuard(),
      memory,
      eventSink: events,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    const task = agentTask({ expectedSchema: { type: 'array' } });
    const result = await runner.execute(task, { attempt: 1 });
    expect(result.data).toBeNull();
  });
});

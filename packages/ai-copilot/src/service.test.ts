import { describe, expect, it } from 'vitest';
import { CopilotService } from './service.js';
import {
  CopilotAuthorizationError,
  CopilotIsolationError,
  CopilotNotFoundError,
  CopilotProviderError,
  CopilotValidationError,
} from './errors.js';
import type { ChatModel, ModelRequest, ModelStreamChunk, ModelToolCall } from './provider.js';
import type { CopilotSources } from './sources.js';
import type { AuditLogger, AuditEntryInput } from './audit.js';
import type { CopilotMetrics } from './metrics.js';
import type { ChatRequest, ChatUsage } from './types.js';
import { InMemoryConversationStore } from './memory.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface ScriptStep {
  text?: string;
  toolCalls?: ModelToolCall[];
  usage?: ChatUsage;
  error?: string;
  model?: string;
}

class ScriptedModel implements ChatModel {
  readonly name = 'scripted';
  readonly models = ['scripted-1'];
  requests: ModelRequest[] = [];
  private readonly steps: ScriptStep[][];

  constructor(steps: ScriptStep[][]) {
    this.steps = steps;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request);
    const turnSteps = this.steps.shift() ?? [{ text: '' }];
    for (const step of turnSteps) {
      if (step.error !== undefined) {
        yield { type: 'error', message: step.error };
        return;
      }
      if (step.text !== undefined && step.text.length > 0) {
        yield { type: 'delta', text: step.text };
      }
      yield {
        type: 'done',
        response: {
          text: step.text ?? '',
          toolCalls: step.toolCalls ?? [],
          usage: step.usage ?? { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          model: step.model ?? 'scripted-1',
        },
      };
    }
  }
}

class ThrowingModel implements ChatModel {
  readonly name = 'throwing';
  readonly models = ['throwing-1'];

  stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<ModelStreamChunk>> {
            throw new Error('network down');
          },
        };
      },
    };
  }
}

class AuditSpy implements AuditLogger {
  entries: AuditEntryInput[] = [];
  record(input: AuditEntryInput): void {
    this.entries.push(input);
  }
}

class MetricsSpy implements CopilotMetrics {
  calls: string[] = [];
  private track(name: string): void {
    this.calls.push(name);
  }
  message(): void { this.track('message'); }
  session(): void { this.track('session'); }
  turn(): void { this.track('turn'); }
  toolCall(): void { this.track('toolCall'); }
  toolError(): void { this.track('toolError'); }
  permissionDenied(): void { this.track('permissionDenied'); }
  modelError(): void { this.track('modelError'); }
  tokens(_usage: ChatUsage): void { this.track('tokens'); }
  latency(_ms: number): void { this.track('latency'); }
}

function makeSources(): CopilotSources {
  return {
    recommendations: {
      async listRecommendations() {
        return [
          {
            id: 'r1',
            rule: 'missing-title',
            title: 'Add missing titles',
            description: 'Pages without titles',
            rationale: 'Titles drive ranking',
            recommendedAction: 'Add a title tag',
            priority: 'medium',
            score: 60,
            impact: 'medium',
            effort: 'low',
            confidence: 0.8,
            affectedUrls: ['/a'],
            pageCount: 1,
          },
        ];
      },
    },
    observability: {
      async overview() {
        return { storeCount: 1, executionCount: 0, activeExecutionCount: 0, completedCount: 0, failedCount: 0, rolledBackCount: 0, alertCount: 0, openAlertCount: 0, latestSeoScore: 71, latestExecutionAt: null, successRate: 0 };
      },
      async crawlSummary() {
        return { latestScore: 71, previousScore: 68, delta: 3, pagesCrawled: 100, totalIssues: 4, brokenLinks: 0, snapshots: 2 };
      },
      async executionSummary() {
        return { totalExecutions: 2, queued: 0, executing: 0, completed: 1, failed: 1, cancelled: 0, rolledBack: 0, successRate: 0.5, failureRate: 0.5, rollbackRate: 0, averageExecutionTimeMs: 100, p95ExecutionTimeMs: 200, validationFailures: 0, safetyViolations: 0, totalRollbacks: 0, crawlSuccessRate: 1, simulated: 0 };
      },
      async alerts() {
        return { total: 0, critical: 0, warning: 0, info: 0, items: [] };
      },
    },
    decision: {
      async listPlans() {
        return [{ id: 'plan_1', status: 'APPROVED', risk: 'LOW', taskCount: 2, totalImpact: 30, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }];
      },
    },
    reports: {
      async generateReport(input) {
        return {
          id: 'rep_1',
          name: input.kind ?? 'dashboard',
          kind: input.kind ?? 'executive-dashboard',
          period: { startDate: '2026-01-01', endDate: '2026-01-31' },
          generatedAt: '2026-01-31T00:00:00.000Z',
          sections: [{ kind: 'kpis', title: 'KPIs' }],
          kpis: [],
          alerts: null,
        };
      },
    },
  };
}

const request = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  message: 'hello',
  tenantId: 'tenant_a',
  role: 'member',
  ...overrides,
});

function makeService(options: {
  model?: ChatModel;
  sources?: CopilotSources;
  audit?: AuditSpy;
  metrics?: MetricsSpy;
  authorize?: (role: string, permission: string) => void;
  store?: InMemoryConversationStore;
  now?: () => string;
  id?: () => string;
  defaultHistory?: number;
  maxToolTurns?: number;
  defaultModel?: string;
} = {}) {
  const audit = options.audit ?? new AuditSpy();
  const metrics = options.metrics ?? new MetricsSpy();
  const service = new CopilotService({
    model: options.model ?? new ScriptedModel([[{ text: 'Hello!' }]]),
    sources: options.sources ?? makeSources(),
    store: options.store ?? new InMemoryConversationStore(),
    audit,
    metrics,
    authorize: options.authorize,
    now: options.now ?? (() => '2026-01-01T00:00:00.000Z'),
    id: options.id ?? (() => 'conv_fixed'),
    defaultHistory: options.defaultHistory,
    maxToolTurns: options.maxToolTurns,
    defaultModel: options.defaultModel,
  });
  return { service, audit, metrics };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CopilotService.chat', () => {
  it('answers a plain message with usage, model and prompt', async () => {
    const model = new ScriptedModel([[{ text: 'Hello!', usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } }]]);
    const { service, audit, metrics } = makeService({ model });

    const response = await service.chat(request());
    expect(response.message).toEqual({ role: 'assistant', content: 'Hello!' });
    expect(response.usage).toEqual({ promptTokens: 3, completionTokens: 2, totalTokens: 5 });
    expect(response.model).toBe('scripted-1');
    expect(response.promptId).toBe('copilot.answer');
    expect(response.toolCalls).toEqual([]);
    expect(response.sessionId).toBe('conv_fixed');

    const modelRequest = model.requests[0]!;
    expect(modelRequest.model).toBe('scripted-1');
    expect(modelRequest.messages[0]?.role).toBe('system');
    expect(modelRequest.messages[modelRequest.messages.length - 1]).toEqual({ role: 'user', content: 'hello' });
    expect(modelRequest.tools).toHaveLength(10);

    expect(metrics.calls).toContain('session');
    expect(metrics.calls).toContain('turn');
    expect(metrics.calls).toContain('message');
    expect(metrics.calls).toContain('tokens');
    expect(metrics.calls).toContain('latency');

    const actions = audit.entries.map((entry) => entry.action);
    expect(actions).toContain('copilot.session.created');
    expect(actions).toContain('copilot.chat');
  });

  it('classifies the request into a topic prompt', async () => {
    const { service } = makeService();
    const response = await service.chat(request({ message: 'explain the missing title recommendation' }));
    expect(response.promptId).toBe('copilot.explain');
  });

  it('applies defaults for audit, metrics, ids and model', async () => {
    const model = new ScriptedModel([[{ text: 'hi' }]]);
    const service = new CopilotService({ model, sources: makeSources() });
    const response = await service.chat(request());
    expect(response.message.content).toBe('hi');
    expect(response.model).toBe('scripted-1');
    expect(response.sessionId).toMatch(/^conv_/);
  });

  it('falls back to a default model name when none is configured', async () => {
    const model: ChatModel = {
      name: 'empty',
      models: [],
      async *stream() {
        yield {
          type: 'done',
          response: { text: 'ok', toolCalls: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: '' },
        };
      },
    };
    const { service } = makeService({ model });
    const response = await service.chat(request());
    expect(response.model).toBe('default');
  });

  it('defaults the role to viewer when omitted', async () => {
    const model = new ScriptedModel([
      [{ toolCalls: [{ id: 'c1', name: 'list_plans', arguments: '{}' }] }],
      [{ text: 'Done.' }],
    ]);
    const { service } = makeService({ model });
    const response = await service.chat(request({ role: undefined }));
    expect(response.message.content).toBe('Done.');
  });

  it('wraps non-error stream failures into a fallback message', async () => {
    const model: ChatModel = {
      name: 'throwy',
      models: ['throwy-1'],
      stream(): AsyncIterable<ModelStreamChunk> {
        return {
          [Symbol.asyncIterator]() {
            return {
              async next(): Promise<IteratorResult<ModelStreamChunk>> {
                throw 'boom';
              },
            };
          },
        };
      },
    };
    const { service } = makeService({ model });
    const error = await service.chat(request()).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CopilotProviderError);
    expect((error as Error).message).toBe('Chat model failed.');
  });

  it('respects an explicit model and temperature', async () => {
    const model = new ScriptedModel([[{ text: 'ok' }]]);
    const { service } = makeService({ model });
    await service.chat(request({ model: 'scripted-2', temperature: 0.2 }));
    expect(model.requests[0]?.model).toBe('scripted-2');
    expect(model.requests[0]?.temperature).toBe(0.2);
  });

  it('falls back to the request model when the model omits its name', async () => {
    const model = new ScriptedModel([[{ text: 'ok', model: '' }]]);
    const { service } = makeService({ model, defaultModel: 'fallback-model' });
    const response = await service.chat(request({ model: 'explicit' }));
    expect(response.model).toBe('explicit');
  });

  it('executes tool calls and feeds results back to the model', async () => {
    const model = new ScriptedModel([
      [{ toolCalls: [{ id: 'call_1', name: 'list_recommendations', arguments: '{"limit":1}' }] }],
      [{ text: 'Here is the recommendation.' }],
    ]);
    const { service, audit, metrics } = makeService({ model });

    const response = await service.chat(request());
    expect(response.toolCalls).toHaveLength(1);
    const executed = response.toolCalls[0];
    expect(executed?.call).toEqual({ id: 'call_1', name: 'list_recommendations', arguments: { limit: 1 } });
    expect(executed?.result.ok).toBe(true);
    expect(executed?.permission).toBe('org.read');

    expect(model.requests).toHaveLength(2);
    const secondRequest = model.requests[1];
    const toolMessage = secondRequest?.messages.find((m) => m.role === 'tool');
    expect(toolMessage).toMatchObject({ role: 'tool', toolCallId: 'call_1', name: 'list_recommendations' });

    expect(metrics.calls).toContain('toolCall');
    const actions = audit.entries.map((entry) => entry.action);
    expect(actions).toContain('copilot.tool');
  });

  it('continues after a permission-denied tool call', async () => {
    const model = new ScriptedModel([
      [{ toolCalls: [{ id: 'call_1', name: 'list_recommendations', arguments: '{}' }] }],
      [{ text: 'I cannot read recommendations for you.' }],
    ]);
    const { service, audit, metrics } = makeService({
      model,
      authorize: (role, permission) => {
        if (permission === 'org.read') {
          throw new CopilotAuthorizationError(`denied for ${role}`);
        }
      },
    });

    const response = await service.chat(request());
    expect(response.message.content).toContain('cannot read');
    const executed = response.toolCalls[0];
    expect(executed?.result.ok).toBe(false);
    expect(executed?.result.error).toContain('Permission denied');

    expect(metrics.calls).toContain('permissionDenied');
    const denied = audit.entries.find((entry) => entry.action === 'copilot.permission.denied');
    expect(denied?.resourceType).toBe('copilot.tool');
    expect(denied?.resourceId).toBe('list_recommendations');
  });

  it('handles unknown tool calls', async () => {
    const model = new ScriptedModel([
      [{ toolCalls: [{ id: 'call_1', name: 'nonexistent_tool', arguments: '{}' }] }],
      [{ text: 'No such tool.' }],
    ]);
    const { service } = makeService({ model });
    const response = await service.chat(request());
    const executed = response.toolCalls[0];
    expect(executed?.result.ok).toBe(false);
    expect(executed?.result.error).toContain("Unknown tool 'nonexistent_tool'");
    expect(executed?.permission).toBe('');
  });

  it('records tool error metrics for failing tools', async () => {
    const model = new ScriptedModel([
      [{ toolCalls: [{ id: 'call_1', name: 'list_recommendations', arguments: '{}' }] }],
      [{ text: 'done' }],
    ]);
    const { service, metrics } = makeService({
      model,
      sources: { recommendations: { async listRecommendations() { throw new Error('boom'); } } },
    });
    const response = await service.chat(request());
    expect(response.toolCalls[0]?.result.ok).toBe(false);
    expect(metrics.calls).toContain('toolError');
  });

  it('caps the tool loop and answers with a limit notice', async () => {
    const model = new ScriptedModel([
      [{ toolCalls: [{ id: 'c1', name: 'list_recommendations', arguments: '{}' }] }],
      [{ toolCalls: [{ id: 'c2', name: 'list_recommendations', arguments: '{}' }] }],
      [{ text: 'never reached' }],
    ]);
    const { service } = makeService({ model, maxToolTurns: 2 });
    const response = await service.chat(request());
    expect(response.message.content).toContain('tool-call limit');
    expect(response.toolCalls).toHaveLength(2);
  });

  it('rejects empty messages and tenants', async () => {
    const { service } = makeService();
    await expect(service.chat(request({ message: '  ' }))).rejects.toThrow(CopilotValidationError);
    await expect(service.chat(request({ tenantId: '' }))).rejects.toThrow(CopilotValidationError);
  });

  it('rejects when the base permission is denied', async () => {
    const { service, audit, metrics } = makeService({
      authorize: () => {
        throw new CopilotAuthorizationError('nope');
      },
    });
    await expect(service.chat(request())).rejects.toThrow(CopilotAuthorizationError);
    expect(metrics.calls).toContain('permissionDenied');
    expect(audit.entries.some((entry) => entry.action === 'copilot.permission.denied')).toBe(true);
  });

  it('wraps model stream errors into provider errors', async () => {
    const { service, metrics } = makeService({ model: new ThrowingModel() });
    await expect(service.chat(request())).rejects.toThrow(CopilotProviderError);
    expect(metrics.calls).toContain('modelError');
  });

  it('surfaces model error chunks as provider errors', async () => {
    const model = new ScriptedModel([[{ error: 'rate limited' }]]);
    const { service, metrics } = makeService({ model });
    await expect(service.chat(request())).rejects.toThrow(/rate limited/);
    expect(metrics.calls).toContain('modelError');
  });

  it('throws when the request is aborted', async () => {
    const { service } = makeService();
    const controller = new AbortController();
    controller.abort();
    await expect(service.chat(request({ signal: controller.signal }))).rejects.toThrow(/aborted/);
  });

  it('windows history for the model', async () => {
    const model = new ScriptedModel([[{ text: 'ok' }]]);
    const { service } = makeService({ model, defaultHistory: 5 });
    await service.chat(request({ history: 0 }));
    expect(model.requests[0]?.messages).toHaveLength(1);
  });

  it('supports custom tool sets', async () => {
    const custom = {
      name: 'custom_tool',
      description: 'Custom',
      permission: 'org.manage',
      parameters: {},
      async execute() {
        return { toolCallId: '', name: 'custom_tool', ok: true, output: { custom: true } };
      },
    };
    const model = new ScriptedModel([
      [{ toolCalls: [{ id: 'c1', name: 'custom_tool', arguments: '{}' }] }],
      [{ text: 'used custom' }],
    ]);
    const service = new CopilotService({
      model,
      sources: makeSources(),
      tools: [custom],
      audit: new AuditSpy(),
      metrics: new MetricsSpy(),
    });
    const response = await service.chat(request());
    expect(response.toolCalls[0]?.call.name).toBe('custom_tool');
    expect(response.toolCalls[0]?.permission).toBe('org.manage');
    expect(model.requests[0]?.tools).toEqual([
      { name: 'custom_tool', description: 'Custom', parameters: {} },
    ]);
  });
});

describe('CopilotService.stream', () => {
  it('emits deltas and a done event', async () => {
    const model = new ScriptedModel([[{ text: 'Hello ' }, { text: 'world' }]]);
    const { service } = makeService({ model });
    const types: string[] = [];
    let finalText = '';
    for await (const event of service.stream(request())) {
      types.push(event.type);
      if (event.type === 'delta') finalText += event.text;
    }
    expect(types).toEqual(['delta', 'delta', 'done']);
    expect(finalText).toBe('Hello world');
  });

  it('emits tool-call and tool-result events around execution', async () => {
    const model = new ScriptedModel([
      [{ toolCalls: [{ id: 'c1', name: 'list_plans', arguments: '{}' }] }],
      [{ text: 'Plans listed.' }],
    ]);
    const { service } = makeService({ model });
    const types: string[] = [];
    for await (const event of service.stream(request())) {
      types.push(event.type);
      if (event.type === 'tool-call') {
        expect(event.toolCall.name).toBe('list_plans');
      }
      if (event.type === 'tool-result') {
        expect(event.result.ok).toBe(true);
      }
    }
    expect(types).toEqual(['tool-call', 'tool-result', 'delta', 'done']);
  });

  it('handles tool-call chunks emitted by the stream', async () => {
    let turns = 0;
    const model: ChatModel = {
      name: 'chunky',
      models: ['chunky-1'],
      async *stream(): AsyncIterable<ModelStreamChunk> {
        const turn = turns++;
        if (turn === 0) {
          yield { type: 'tool-call', call: { id: 'c9', name: 'get_alerts', arguments: '{}' } };
          yield {
            type: 'done',
            response: {
              text: '',
              toolCalls: [{ id: 'c9', name: 'get_alerts', arguments: '{}' }],
              usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
              model: 'chunky-1',
            },
          };
          return;
        }
        yield {
          type: 'done',
          response: {
            text: 'Alerts fetched.',
            toolCalls: [],
            usage: { promptTokens: 3, completionTokens: 3, totalTokens: 6 },
            model: 'chunky-1',
          },
        };
      },
    };
    const { service } = makeService({ model });
    const types: string[] = [];
    let sawChunkCall = false;
    let finalText = '';
    for await (const event of service.stream(request())) {
      types.push(event.type);
      if (event.type === 'tool-call') {
        sawChunkCall = event.toolCall.id === 'c9';
      }
      if (event.type === 'done') {
        finalText = event.response.message.content;
      }
    }
    expect(sawChunkCall).toBe(true);
    expect(types).toEqual(['tool-call', 'tool-result', 'done']);
    expect(finalText).toBe('Alerts fetched.');
  });

  it('propagates errors to the consumer', async () => {
    const { service } = makeService({ model: new ThrowingModel() });
    const events: string[] = [];
    await expect(async () => {
      for await (const event of service.stream(request())) {
        events.push(event.type);
      }
    }).rejects.toThrow(CopilotProviderError);
    expect(events).toEqual([]);
  });
});

describe('CopilotService sessions', () => {
  it('creates sessions with the system prompt and capabilities', async () => {
    const store = new InMemoryConversationStore();
    const { service } = makeService({ store });
    const session = await service.createSession({ tenantId: 'tenant_a', storeId: 'store_1', userId: 'user_1' });
    expect(session.sessionId).toBe('conv_fixed');
    expect(session.messages[0]?.role).toBe('system');
    expect(session.messages[0]?.content).toContain('list_recommendations');
    const listed = await service.listSessions({ tenantId: 'tenant_a' });
    expect(listed).toHaveLength(1);
  });

  it('rejects creating sessions without a tenant', async () => {
    const { service } = makeService();
    await expect(service.createSession({ tenantId: '' })).rejects.toThrow(CopilotValidationError);
  });

  it('resumes an existing session and rejects cross-tenant reads', async () => {
    const store = new InMemoryConversationStore();
    const model = new ScriptedModel([[{ text: 'first' }], [{ text: 'second' }]]);
    const { service } = makeService({ store, model });

    await service.chat(request());
    const second = await service.chat(request({ sessionId: 'conv_fixed' }));
    expect(second.message.content).toBe('second');
    const session = await service.getSession('conv_fixed', 'tenant_a');
    const userMessages = session.messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(2);

    await expect(service.getSession('conv_fixed', 'tenant_b')).rejects.toThrow(CopilotIsolationError);
    await expect(service.chat(request({ sessionId: 'conv_fixed', tenantId: 'tenant_b' }))).rejects.toThrow(
      CopilotIsolationError,
    );
  });

  it('rejects unknown sessions', async () => {
    const { service } = makeService();
    await expect(service.getSession('conv_unknown', 'tenant_a')).rejects.toThrow(CopilotNotFoundError);
    await expect(service.chat(request({ sessionId: 'conv_unknown' }))).rejects.toThrow(CopilotNotFoundError);
  });

  it('rejects blank session ids', async () => {
    const { service } = makeService();
    await expect(service.getSession('   ', 'tenant_a')).rejects.toThrow(CopilotValidationError);
  });

  it('deletes sessions and records audit', async () => {
    const { service, audit } = makeService();
    await service.createSession({ tenantId: 'tenant_a' });
    await service.deleteSession('conv_fixed', 'tenant_a');
    await expect(service.getSession('conv_fixed', 'tenant_a')).rejects.toThrow(CopilotNotFoundError);
    expect(audit.entries.some((entry) => entry.action === 'copilot.session.deleted')).toBe(true);
  });

  it('lists sessions scoped by user', async () => {
    const store = new InMemoryConversationStore();
    let n = 0;
    const { service } = makeService({ store, id: () => `conv_${n++}` });
    await service.createSession({ tenantId: 'tenant_a', userId: 'u1' });
    await service.createSession({ tenantId: 'tenant_a', userId: 'u2' });
    const listed = await service.listSessions({ tenantId: 'tenant_a', userId: 'u1' });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.userId).toBe('u1');
  });
});

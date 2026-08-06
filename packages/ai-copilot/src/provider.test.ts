import { describe, expect, it, vi } from 'vitest';
import type { Provider, ProviderRequest } from '@seogod/ai-orchestrator';
import { CopilotProviderError } from './errors.js';
import {
  completeStream,
  fromOrchestratorProvider,
  toModelMessages,
  ZERO_USAGE,
  type ChatModel,
} from './provider.js';
import type { CopilotMessage } from './types.js';

function stubModel(): ChatModel {
  return {
    name: 'stub',
    models: ['stub-1'],
    async *stream() {
      yield { type: 'delta', text: 'Hel' };
      yield { type: 'delta', text: 'lo' };
      yield {
        type: 'done',
        response: {
          text: 'Hello',
          toolCalls: [],
          usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
          model: 'stub-1',
        },
      };
    },
  };
}

describe('toModelMessages', () => {
  it('maps roles and carries tool metadata', () => {
    const messages: CopilotMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hey' },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'call_1', name: 'list_recommendations' },
    ];
    const result = toModelMessages(messages);
    expect(result).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hey' },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'call_1', name: 'list_recommendations' },
    ]);
  });

  it('omits tool metadata for non-tool messages', () => {
    const [first] = toModelMessages([{ role: 'user', content: 'x' }]);
    expect(first).toEqual({ role: 'user', content: 'x' });
  });
});

describe('completeStream', () => {
  it('aggregates deltas and the done response', async () => {
    const response = await completeStream(stubModel().stream({ model: 'stub-1', messages: [] }));
    expect(response.text).toBe('Hello');
    expect(response.usage).toEqual({ promptTokens: 2, completionTokens: 3, totalTokens: 5 });
    expect(response.model).toBe('stub-1');
  });

  it('collects tool calls across chunks', async () => {
    const chunks = (async function* () {
      yield { type: 'tool-call' as const, call: { id: 'c1', name: 'get_alerts', arguments: '{}' } };
      yield {
        type: 'done' as const,
        response: { text: '', toolCalls: [], usage: ZERO_USAGE, model: 'm' },
      };
    })();
    const response = await completeStream(chunks);
    expect(response.toolCalls).toEqual([{ id: 'c1', name: 'get_alerts', arguments: '{}' }]);
  });

  it('throws on error chunks', async () => {
    const chunks = (async function* () {
      yield { type: 'error' as const, message: 'boom' };
    })();
    await expect(completeStream(chunks)).rejects.toThrow(CopilotProviderError);
  });

  it('dedupes tool calls repeated in the done response', async () => {
    const chunks = (async function* () {
      yield { type: 'tool-call' as const, call: { id: 'c1', name: 'get_alerts', arguments: '{}' } };
      yield {
        type: 'done' as const,
        response: { text: '', toolCalls: [{ id: 'c1', name: 'get_alerts', arguments: '{}' }], usage: ZERO_USAGE, model: 'm' },
      };
    })();
    const response = await completeStream(chunks);
    expect(response.toolCalls).toEqual([{ id: 'c1', name: 'get_alerts', arguments: '{}' }]);
  });

  it('merges tool calls from the done response with earlier chunks', async () => {
    const chunks = (async function* () {
      yield { type: 'tool-call' as const, call: { id: 'c1', name: 'get_alerts', arguments: '{}' } };
      yield {
        type: 'done' as const,
        response: { text: '', toolCalls: [{ id: 'c2', name: 'list_plans', arguments: '{}' }], usage: ZERO_USAGE, model: 'm' },
      };
    })();
    const response = await completeStream(chunks);
    expect(response.toolCalls).toEqual([
      { id: 'c1', name: 'get_alerts', arguments: '{}' },
      { id: 'c2', name: 'list_plans', arguments: '{}' },
    ]);
  });

  it('uses the done response as authoritative', async () => {
    const chunks = (async function* () {
      yield { type: 'delta' as const, text: 'stale' };
      yield {
        type: 'done' as const,
        response: { text: 'final', toolCalls: [], usage: ZERO_USAGE, model: 'm2' },
      };
    })();
    const response = await completeStream(chunks);
    expect(response.text).toBe('final');
    expect(response.model).toBe('m2');
  });
});

describe('fromOrchestratorProvider', () => {
  function makeProvider(overrides: Partial<Provider> = {}): Provider {
    return {
      name: 'orchestrator-provider',
      models: ['gpt-mini'],
      async complete(request: ProviderRequest) {
        return {
          text: request.messages.length > 0 ? 'orchestrated' : '',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          model: 'gpt-mini',
        };
      },
      async checkHealth() {
        return { status: 'ok' };
      },
      ...overrides,
    };
  }

  it('adapts name, models and a completion into streaming chunks', async () => {
    const provider = makeProvider();
    const model = fromOrchestratorProvider(provider);
    expect(model.name).toBe('orchestrator-provider');
    expect(model.models).toEqual(['gpt-mini']);

    const chunks: string[] = [];
    let response;
    for await (const chunk of model.stream({ model: 'gpt-mini', messages: [{ role: 'user', content: 'hi' }] })) {
      if (chunk.type === 'delta') chunks.push(chunk.text);
      if (chunk.type === 'done') response = chunk.response;
    }
    expect(chunks).toEqual(['orchestrated']);
    expect(response?.model).toBe('gpt-mini');
    expect(response?.usage.totalTokens).toBe(2);
  });

  it('forwards temperature, maxTokens, signal and tools', async () => {
    const spy = vi.fn<(request: ProviderRequest) => Promise<{ text: string; usage: typeof ZERO_USAGE; model: string }>>();
    const provider = makeProvider({
      async complete(request) {
        spy(request);
        return { text: 'ok', usage: ZERO_USAGE, model: 'gpt-mini' };
      },
    });
    const model = fromOrchestratorProvider(provider);
    const signal = new AbortController().signal;
    const tools = [{ name: 'get_alerts', description: 'alerts', parameters: {} }];
    for await (const _chunk of model.stream({
      model: 'gpt-mini',
      messages: [],
      temperature: 0.5,
      maxTokens: 100,
      tools,
      signal,
    })) {
      // consume
    }
    const firstCall = spy.mock.calls[0];
    const request = firstCall?.[0];
    expect(request?.temperature).toBe(0.5);
    expect(request?.maxTokens).toBe(100);
    expect(request?.options).toEqual({ tools });
    expect(request?.messages).toEqual([]);
  });

  it('flattens tool messages into assistant messages', async () => {
    const seen: ProviderRequest[] = [];
    const provider = makeProvider({
      async complete(request) {
        seen.push(request);
        return { text: '', usage: ZERO_USAGE, model: 'gpt-mini' };
      },
    });
    const model = fromOrchestratorProvider(provider);
    for await (const _chunk of model.stream({
      model: 'gpt-mini',
      messages: [{ role: 'tool', content: '{"ok":true}', name: 'get_alerts', toolCallId: 'c1' }],
    })) {
      // consume
    }
    expect(seen[0]?.messages).toEqual([{ role: 'assistant', content: '[get_alerts result] {"ok":true}' }]);
  });

  it('labels tool messages without a name as generic tool results', async () => {
    const seen: ProviderRequest[] = [];
    const provider = makeProvider({
      async complete(request) {
        seen.push(request);
        return { text: '', usage: ZERO_USAGE, model: 'gpt-mini' };
      },
    });
    const model = fromOrchestratorProvider(provider);
    for await (const _chunk of model.stream({
      model: 'gpt-mini',
      messages: [{ role: 'tool', content: '{"ok":true}', toolCallId: 'c1' }],
    })) {
      // consume
    }
    expect(seen[0]?.messages).toEqual([{ role: 'assistant', content: '[tool result] {"ok":true}' }]);
  });

  it('yields an error chunk when the provider throws', async () => {
    const provider = makeProvider({
      async complete() {
        throw new Error('provider down');
      },
    });
    const model = fromOrchestratorProvider(provider);
    const events: string[] = [];
    for await (const chunk of model.stream({ model: 'gpt-mini', messages: [] })) {
      events.push(chunk.type);
      if (chunk.type === 'error') {
        expect(chunk.message).toContain('provider down');
      }
    }
    expect(events).toEqual(['error']);
  });

  it('yields a fallback message when the provider throws a non-error', async () => {
    const provider = makeProvider({
      async complete() {
        throw 'not-an-error';
      },
    });
    const model = fromOrchestratorProvider(provider);
    const events: string[] = [];
    for await (const chunk of model.stream({ model: 'gpt-mini', messages: [] })) {
      events.push(chunk.type);
      if (chunk.type === 'error') {
        expect(chunk.message).toBe('Provider call failed.');
      }
    }
    expect(events).toEqual(['error']);
  });

  it('does not emit a delta when the completion text is empty', async () => {
    const provider = makeProvider({
      async complete() {
        return { text: '', usage: ZERO_USAGE, model: 'gpt-mini' };
      },
    });
    const model = fromOrchestratorProvider(provider);
    const types: string[] = [];
    for await (const chunk of model.stream({ model: 'gpt-mini', messages: [] })) {
      types.push(chunk.type);
    }
    expect(types).toEqual(['done']);
  });
});

describe('ZERO_USAGE', () => {
  it('is a frozen zero usage', () => {
    expect(ZERO_USAGE).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });
});

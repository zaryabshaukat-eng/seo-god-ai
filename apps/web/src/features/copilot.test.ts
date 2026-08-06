import { describe, expect, it, vi } from 'vitest';
import { renderToString } from '../vdom.js';
import type { ChatMessage, CopilotStreamEvent, CopilotSession } from '../types.js';
import type { ChatState } from './copilot.js';
import {
  applyStreamEvent,
  createChatStore,
  createCopilotApi,
  messageClass,
  renderCopilotPage,
  validateChatInput,
} from './copilot.js';

describe('validateChatInput', () => {
  it('accepts trimmed non-empty input', () => {
    expect(validateChatInput('  hello  ')).toEqual({ valid: true });
  });

  it('rejects empty input', () => {
    expect(validateChatInput('   ')).toEqual({ valid: false, error: 'Type a message first.' });
  });

  it('rejects over-length input', () => {
    const result = validateChatInput('x'.repeat(4001));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('4000');
  });
});

describe('applyStreamEvent', () => {
  const id = () => 'm';
  const base = (): ChatState => ({ messages: [], isStreaming: false, input: '' });

  it('starts an assistant message', () => {
    const state = applyStreamEvent(base(), { type: 'start' }, id);
    expect(state.isStreaming).toBe(true);
    expect(state.messages[0]).toMatchObject({ role: 'assistant', content: '' });
  });

  it('appends deltas to the last assistant message', () => {
    let state = applyStreamEvent(base(), { type: 'start' }, id);
    state = applyStreamEvent(state, { type: 'delta', text: 'Hel' }, id);
    state = applyStreamEvent(state, { type: 'delta', text: 'lo' }, id);
    expect(state.messages[state.messages.length - 1]?.content).toBe('Hello');
  });

  it('ignores deltas without an assistant tail', () => {
    const state = applyStreamEvent(base(), { type: 'delta', text: 'x' }, id);
    expect(state.messages).toEqual([]);
  });

  it('records tool calls and results', () => {
    let state = applyStreamEvent(base(), { type: 'tool-call', id: '7', tool: 'crawl', args: '{}' }, id);
    expect(state.messages[0]).toMatchObject({ role: 'tool', kind: 'tool-call', toolName: 'crawl' });
    state = applyStreamEvent(state, { type: 'tool-result', id: '7', result: 'ok' }, id);
    expect(state.messages[1]).toMatchObject({ role: 'tool', kind: 'tool-result', toolName: '#7' });
  });

  it('finishes streaming on done', () => {
    const state = applyStreamEvent(base(), { type: 'done', messageId: 'm' }, id);
    expect(state.isStreaming).toBe(false);
  });

  it('records errors', () => {
    const state = applyStreamEvent(base(), { type: 'error', message: 'boom' }, id);
    expect(state.error).toBe('boom');
    expect(state.isStreaming).toBe(false);
    expect(state.messages[0]).toMatchObject({ kind: 'error' });
  });

  it('ignores unknown event types', () => {
    const state = base();
    expect(applyStreamEvent(state, { type: 'heartbeat' } as never, id)).toBe(state);
  });
});

describe('createChatStore', () => {
  it('sends a message and consumes the stream', async () => {
    const streamChat = vi.fn(async function* () {
      yield { type: 'start' as const };
      yield { type: 'delta' as const, text: 'Hi' };
      yield { type: 'done' as const, messageId: 'm1' };
    });
    const store = createChatStore({ streamChat });
    await store.send(' hello ');
    expect(streamChat).toHaveBeenCalledOnce();
    const state = store.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(state.messages[1]?.content).toBe('Hi');
    expect(state.input).toBe('');
  });

  it('ignores sends while streaming or empty', async () => {
    const streamChat = vi.fn(async function* () {
      yield { type: 'done' as const, messageId: 'm1' };
    });
    const store = createChatStore({ streamChat });
    store.consumeEvent({ type: 'start' });
    await store.send('blocked');
    await store.send('   ');
    expect(streamChat).not.toHaveBeenCalled();
  });

  it('records a stream error', async () => {
    const streamChat = vi.fn(async function* () {
      throw new Error('network');
      yield { type: 'done' as const, messageId: 'm1' };
    });
    const store = createChatStore({ streamChat });
    await store.send('hello');
    expect(store.getState().error).toBe('network');
    expect(store.getState().isStreaming).toBe(false);
  });

  it('manages input, session and reset', () => {
    const store = createChatStore({ streamChat: async function* () {} });
    store.setInput('typed');
    expect(store.getInput()).toBe('typed');
    store.setSession('s1');
    expect(store.getState().sessionId).toBe('s1');
    const listener = vi.fn();
    store.subscribe(listener);
    store.reset();
    expect(store.getState().messages).toEqual([]);
    expect(listener).toHaveBeenCalled();
  });
});

describe('messageClass', () => {
  it('classifies messages by role and kind', () => {
    expect(messageClass({ id: '1', role: 'user', kind: 'text', content: '', at: 0 })).toBe('chat__message chat__message--user');
    expect(messageClass({ id: '1', role: 'tool', kind: 'tool-call', content: '', at: 0 })).toBe('chat__message chat__message--tool');
    expect(messageClass({ id: '1', role: 'assistant', kind: 'error', content: '', at: 0 })).toBe('chat__message chat__message--error');
    expect(messageClass({ id: '1', role: 'assistant', kind: 'text', content: '', at: 0 })).toBe('chat__message chat__message--assistant');
  });
});

describe('renderCopilotPage', () => {
  const sessions: CopilotSession[] = [{ id: 's1', title: 'Fix titles', createdAt: 0, messageCount: 0 }];
  const messages: ChatMessage[] = [
    { id: '1', role: 'user', kind: 'text', content: 'hi', at: 0 },
    { id: '2', role: 'tool', kind: 'tool-call', content: '{}', toolName: 'crawl', at: 0 },
  ];

  it('renders sessions, messages and a form for writers', () => {
    const html = renderToString(renderCopilotPage({ messages, sessions, isStreaming: false, canWrite: true, input: '' }));
    expect(html).toContain('data-action="copilot:session:s1"');
    expect(html).toContain('chat__message--user');
    expect(html).toContain('chat__code');
    expect(html).toContain('id="copilot-form"');
  });

  it('shows typing state and read-only notice', () => {
    const html = renderToString(renderCopilotPage({ messages: [], sessions: [], isStreaming: true, canWrite: false, input: '' }));
    expect(html).toContain('SEOGOD is thinking…');
    expect(html).toContain('You do not have permission to chat.');
    expect(html).not.toContain('copilot-form');
  });

  it('labels the streaming form submit button', () => {
    const html = renderToString(renderCopilotPage({ messages: [], sessions: [], isStreaming: true, canWrite: true, input: '' }));
    expect(html).toContain('Streaming…');
    expect(html).toContain('copilot-form');
  });
});

describe('createCopilotApi', () => {
  it('lists sessions and streams chat events', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const api = {
      request: async <T>(method: string, url: string, body: unknown): Promise<T> => {
        calls.push({ method, url, body });
        return [{ type: 'done' }] as T;
      },
    } as never;
    const copilotApi = createCopilotApi(api);
    await copilotApi.sessions();
    const events: CopilotStreamEvent[] = [];
    for await (const event of copilotApi.chat([{ id: 'u', role: 'user', kind: 'text', content: 'x', at: 0 }], { sessionId: 's1' })) {
      events.push(event);
    }
    expect(calls[0]).toEqual({ method: 'GET', url: '/api/v1/copilot/sessions', body: undefined });
    expect(calls[1]?.url).toBe('/api/v1/copilot/chat');
    expect((calls[1]?.body as { sessionId: string }).sessionId).toBe('s1');
    expect(events).toEqual([{ type: 'done' }]);
  });
});

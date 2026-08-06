import { createApiFunctions } from './api-helpers.js';
import { createStore } from '../store.js';
import { toWebError, errorMessage } from '../errors.js';
import { formEl, textareaEl } from '../ui/primitives.js';
import { pageHeaderEl } from '../ui/layout.js';
import { h } from '../vdom.js';
import type { ApiClient } from '../api/client.js';
import type { ChatMessage, CopilotSession, CopilotStreamEvent, VNode } from '../types.js';

const MAX_INPUT_LENGTH = 4_000;

export interface CopilotApi {
  sessions(): Promise<CopilotSession[]>;
  chat(
    messages: ChatMessage[],
    options: { sessionId?: string },
  ): AsyncIterable<CopilotStreamEvent>;
}

export interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  input: string;
  sessionId?: string;
  error?: string;
}

export interface ChatStore {
  getState(): ChatState;
  getMessages(): ChatMessage[];
  isStreaming(): boolean;
  setInput(text: string): void;
  getInput(): string;
  send(text: string): Promise<void>;
  consumeEvent(event: CopilotStreamEvent): void;
  setSession(id: string): void;
  reset(): void;
  subscribe(listener: (state: ChatState) => void): () => void;
}

/** Validates chat input: non-empty after trim, within length limits. */
export function validateChatInput(text: string): { valid: boolean; error?: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Type a message first.' };
  }
  if (trimmed.length > MAX_INPUT_LENGTH) {
    return { valid: false, error: `Messages are limited to ${MAX_INPUT_LENGTH} characters.` };
  }
  return { valid: true };
}

/** Applies a streaming event to the chat state. */
export function applyStreamEvent(state: ChatState, event: CopilotStreamEvent, nextId: () => string): ChatState {
  const now = Date.now();
  switch (event.type) {
    case 'start':
      return {
        ...state,
        isStreaming: true,
        error: undefined,
        messages: [...state.messages, { id: nextId(), role: 'assistant', kind: 'text', content: '', at: now }],
      };
    case 'delta': {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== 'assistant' || last.kind !== 'text') {
        return state;
      }
      return {
        ...state,
        messages: [...state.messages.slice(0, -1), { ...last, content: last.content + event.text }],
      };
    }
    case 'tool-call':
      return {
        ...state,
        messages: [...state.messages, { id: nextId(), role: 'tool', kind: 'tool-call', content: event.args, toolName: event.tool, at: now }],
      };
    case 'tool-result':
      return {
        ...state,
        messages: [...state.messages, { id: nextId(), role: 'tool', kind: 'tool-result', content: event.result, toolName: `#${event.id}`, at: now }],
      };
    case 'done':
      return { ...state, isStreaming: false };
    case 'error':
      return {
        ...state,
        isStreaming: false,
        error: event.message,
        messages: [...state.messages, { id: nextId(), role: 'assistant', kind: 'error', content: event.message, at: now }],
      };
    default:
      return state;
  }
}

/** Creates the chat store with an injectable streaming source. */
export function createChatStore(config: { streamChat: CopilotApi['chat'] }): ChatStore {
  const store = createStore<ChatState>({ messages: [], isStreaming: false, input: '' });
  let idCounter = 0;

  const nextId = (): string => `m-${++idCounter}`;

  function consumeEvent(event: CopilotStreamEvent): void {
    store.set((state) => applyStreamEvent(state, event, nextId));
  }

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0 || store.get().isStreaming) {
      return;
    }
    store.set((state) => ({
      ...state,
      input: '',
      isStreaming: true,
      error: undefined,
      messages: [...state.messages, { id: nextId(), role: 'user', kind: 'text', content: trimmed, at: Date.now() }],
    }));
    try {
      const source = config.streamChat(store.get().messages, { sessionId: store.get().sessionId });
      for await (const event of source) {
        consumeEvent(event);
      }
    } catch (error) {
      consumeEvent({ type: 'error', message: errorMessage(toWebError(error)) });
    }
  }

  return {
    getState: () => store.get(),
    getMessages: () => store.get().messages,
    isStreaming: () => store.get().isStreaming,
    setInput(text: string) {
      store.set((state) => ({ ...state, input: text }));
    },
    getInput: () => store.get().input,
    send,
    consumeEvent,
    setSession(id: string) {
      store.set((state) => ({ ...state, sessionId: id }));
    },
    reset() {
      idCounter = 0;
      store.set({ messages: [], isStreaming: false, input: '', sessionId: undefined, error: undefined });
    },
    subscribe: (listener) => store.subscribe(listener),
  };
}

/** CSS class for a chat message based on its role/kind. */
export function messageClass(message: ChatMessage): string {
  if (message.kind === 'error') {
    return 'chat__message chat__message--error';
  }
  if (message.role === 'tool') {
    return 'chat__message chat__message--tool';
  }
  if (message.role === 'user') {
    return 'chat__message chat__message--user';
  }
  return 'chat__message chat__message--assistant';
}

/** Renders the Copilot chat page. */
export function renderCopilotPage(model: {
  messages: ChatMessage[];
  sessions: CopilotSession[];
  isStreaming: boolean;
  canWrite: boolean;
  input: string;
  error?: string;
}): VNode {
  const sessionList = model.sessions.map((session) =>
    h('li', { class: 'chat-sessions__item', key: session.id }, h('a', { href: '#', 'data-action': `copilot:session:${session.id}` }, session.title)),
  );

  const messageList = model.messages.map((message) => {
    const content =
      message.kind === 'tool-call' || message.kind === 'tool-result'
        ? h('pre', { class: 'chat__code' }, message.content)
        : h('p', { class: 'chat__content' }, message.content);
    const toolName = message.toolName ? h('span', { class: 'chat__tool' }, message.toolName) : undefined;
    return h('li', { class: messageClass(message), key: message.id }, toolName, content);
  });

  const inputForm = model.canWrite
    ? formEl({
        id: 'copilot-form',
        fields: [
          textareaEl({ id: 'copilot-input', label: 'Message', value: model.input, placeholder: 'Ask SEO GOD AI…' }),
        ],
        submitLabel: model.isStreaming ? 'Streaming…' : 'Send',
        errorText: model.error,
      })
    : h('p', { class: 'muted' }, 'You do not have permission to chat.');

  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'AI Copilot', subtitle: 'Chat with your SEO operating system' }),
    h(
      'div',
      { class: 'chat' },
      h('aside', { class: 'chat-sessions', 'aria-label': 'Chat sessions' }, h('h2', { class: 'chat-sessions__title' }, 'Sessions'), h('ul', {}, ...sessionList)),
      h('div', { class: 'chat-panel' },
        h('ul', { class: 'chat-log', 'aria-live': 'polite' }, ...messageList),
        model.isStreaming ? h('div', { class: 'chat-typing', role: 'status' }, 'SEOGOD is thinking…') : undefined,
        inputForm,
      ),
    ),
  );
}

/** REST wrappers for Copilot endpoints. */
export function createCopilotApi(api: ApiClient): CopilotApi {
  const call = createApiFunctions(api);
  return {
    sessions() {
      return call.get<CopilotSession[]>('copilotSessions');
    },
    async *chat(messages: ChatMessage[], options: { sessionId?: string }) {
      const body = { messages: messages.slice(-20), sessionId: options.sessionId };
      const events = await call.post<CopilotStreamEvent[]>('copilotChat', body);
      for (const event of events) {
        yield event;
      }
    },
  };
}

/**
 * Streaming chat-model contract and adapters.
 *
 * The copilot defines its own narrow `ChatModel` interface (streaming +
 * structured tool calls) so any vendor can be plugged in. An adapter is
 * provided for the orchestrator's `Provider`, which maps the copilot
 * conversation onto a plain completion.
 */

import type { CopilotMessage, ChatUsage } from './types.js';
import type { Provider, ProviderMessage, ProviderCallOptions } from '@seogod/ai-orchestrator';
import { CopilotProviderError } from './errors.js';

export type ModelMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
  /** Tool result: name of the tool that produced the message. */
  name?: string;
  /** Tool result: id of the tool call this message answers. */
  toolCallId?: string;
}

export interface ModelTool {
  name: string;
  description: string;
  /** JSON Schema-ish object describing the arguments. */
  parameters: Record<string, unknown>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  /** JSON string encoding of the arguments. */
  arguments: string;
}

export interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ModelTool[];
  signal?: AbortSignal;
}

export interface ModelResponse {
  /** Completion text; may be empty for tool-only turns. */
  text: string;
  toolCalls: ModelToolCall[];
  usage: ChatUsage;
  model: string;
}

export type ModelStreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'tool-call'; call: ModelToolCall }
  | { type: 'done'; response: ModelResponse }
  | { type: 'error'; message: string };

/** A streaming chat model. `stream` is the single interface the copilot uses. */
export interface ChatModel {
  readonly name: string;
  readonly models: readonly string[];
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}

export const ZERO_USAGE: ChatUsage = Object.freeze({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });

/** Maps a copilot message onto the model message shape. */
export function toModelMessages(messages: readonly CopilotMessage[]): ModelMessage[] {
  return messages.map((message) => {
    const base: ModelMessage = { role: message.role, content: message.content };
    if (message.role === 'tool') {
      base.name = message.name;
      base.toolCallId = message.toolCallId;
    }
    return base;
  });
}

/** Consumes a stream and aggregates it into a single response. */
export async function completeStream(chunks: AsyncIterable<ModelStreamChunk>): Promise<ModelResponse> {
  let text = '';
  const toolCalls: ModelToolCall[] = [];
  let usage = ZERO_USAGE;
  let model = '';
  for await (const chunk of chunks) {
    switch (chunk.type) {
      case 'delta':
        text += chunk.text;
        break;
      case 'tool-call':
        toolCalls.push(chunk.call);
        break;
      case 'done':
        text = chunk.response.text;
        for (const call of chunk.response.toolCalls) {
          if (!toolCalls.some((existing) => existing.id === call.id)) {
            toolCalls.push(call);
          }
        }
        usage = chunk.response.usage;
        model = chunk.response.model;
        break;
      case 'error':
        throw new CopilotProviderError(chunk.message);
    }
  }
  return { text, toolCalls, usage, model };
}

// ---------------------------------------------------------------------------
// Orchestrator adapter
// ---------------------------------------------------------------------------

const ORCHESTRATOR_ROLES: Readonly<Record<ModelMessage['role'], ProviderMessage['role']>> = {
  system: 'system',
  user: 'user',
  assistant: 'assistant',
  tool: 'assistant',
};

function toProviderMessages(messages: readonly ModelMessage[]): ProviderMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      const label = message.name === undefined ? 'tool' : message.name;
      return { role: 'assistant', content: `[${label} result] ${message.content}` };
    }
    return { role: ORCHESTRATOR_ROLES[message.role], content: message.content };
  });
}

/**
 * Adapts an orchestrator `Provider` into a copilot `ChatModel`. Tool schemas
 * are forwarded through `options` for providers that support them, but tool
 * results cannot round-trip through this adapter: it is intended for direct
 * completion-style chat.
 */
export function fromOrchestratorProvider(provider: Provider): ChatModel {
  return {
    name: provider.name,
    models: provider.models,
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      const callOptions: ProviderCallOptions = { signal: request.signal };
      const providerRequest = {
        model: request.model,
        messages: toProviderMessages(request.messages),
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        options: request.tools === undefined ? undefined : { tools: request.tools },
      };
      let response;
      try {
        response = await provider.complete(providerRequest, callOptions);
      } catch (error) {
        yield { type: 'error', message: error instanceof Error ? error.message : 'Provider call failed.' };
        return;
      }
      if (response.text.length > 0) {
        yield { type: 'delta', text: response.text };
      }
      yield {
        type: 'done',
        response: {
          text: response.text,
          toolCalls: [],
          usage: response.usage,
          model: response.model,
        },
      };
    },
  };
}

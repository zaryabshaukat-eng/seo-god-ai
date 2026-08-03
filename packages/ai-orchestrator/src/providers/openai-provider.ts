import { AiError, RateLimitError } from '@seogod/core';
import type {
  Provider,
  ProviderCallOptions,
  ProviderConfig,
  ProviderHealth,
  ProviderRequest,
  ProviderResponse,
} from '../types/provider.js';
import { TimeoutError } from '../errors.js';
import { withTimeout } from '../utils/async.js';

export interface FetchLike {
  (input: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface OpenAiUsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface OpenAiChoicePayload {
  message?: { content?: string | null };
}

export interface OpenAiResponsePayload {
  choices?: OpenAiChoicePayload[];
  usage?: OpenAiUsagePayload;
  model?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * OpenAI chat-completions provider. Uses the global `fetch` (Node 18+);
 * an injectable fetch keeps tests offline. Errors map to core error types:
 * 429 -> {@link RateLimitError} (retryable), everything else -> {@link AiError}.
 */
export class OpenAIProvider implements Provider {
  readonly name: string;
  readonly models: readonly string[];
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;

  constructor(
    config: ProviderConfig,
    options: { fetchFn?: FetchLike } = {},
  ) {
    if (config.name !== 'openai') {
      throw new AiError(`Provider name must be "openai", got "${config.name}"`, {
        module: 'ai-orchestrator',
        operation: 'provider.construct',
      });
    }
    this.name = config.name;
    this.models = [config.model];
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? (fetch as FetchLike);
  }

  async complete(
    request: ProviderRequest,
    callOptions: ProviderCallOptions = {},
  ): Promise<ProviderResponse> {
    const started = Date.now();
    const body = this.buildBody(request);
    try {
      const response = await withTimeout(
        this.perform(body, request.model, callOptions.signal),
        callOptions.timeoutMs ?? this.timeoutMs,
        callOptions.signal,
      );
      const payload = await this.parsePayload(response);
      const usage = payload.usage;
      const promptTokens = usage?.prompt_tokens ?? 0;
      const completionTokens = usage?.completion_tokens ?? 0;
      return {
        text: this.extractText(payload),
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: usage?.total_tokens ?? promptTokens + completionTokens,
        },
        model: payload.model ?? request.model,
        raw: payload as unknown as Record<string, unknown>,
      };
    } catch (error) {
      if (error instanceof RateLimitError) throw error;
      if (error instanceof TimeoutError) throw error;
      throw new AiError(`OpenAI request failed after ${Date.now() - started}ms: ${String(error)}`, {
        module: 'ai-orchestrator',
        operation: 'provider.complete',
        context: { provider: this.name, model: request.model },
        cause: error,
      });
    }
  }

  async checkHealth(): Promise<ProviderHealth> {
    try {
      const response = await this.request(
        { model: this.models[0] ?? '', messages: [], max_tokens: 1 },
        this.models[0] ?? 'unknown',
        undefined,
        1,
      );
      if (response.status === 401 || response.status === 403) {
        return { status: 'down', detail: `authentication rejected (HTTP ${response.status})` };
      }
      if (response.status >= 400) {
        return { status: 'degraded', detail: `HTTP ${response.status}` };
      }
      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'down',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildBody(request: ProviderRequest): Record<string, unknown> {
    return {
      model: request.model,
      messages: request.messages,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
      ...request.options,
    };
  }

  private async request(
    body: Record<string, unknown>,
    model: string,
    signal: AbortSignal | undefined,
    maxTokens: number,
  ): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey !== undefined) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return this.fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, max_tokens: maxTokens }),
      signal,
    });
  }

  private async perform(
    body: Record<string, unknown>,
    model: string,
    signal: AbortSignal | undefined,
    maxTokens: number = typeof body.max_tokens === 'number' ? body.max_tokens : 0,
  ): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
    const response = await this.request(body, model, signal, maxTokens);
    if (response.status === 429) {
      throw new RateLimitError('OpenAI rate limit exceeded', {
        module: 'ai-orchestrator',
        operation: 'provider.complete',
        context: { provider: this.name, model },
      });
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new AiError(`OpenAI returned HTTP ${response.status}: ${detail.slice(0, 200)}`, {
        module: 'ai-orchestrator',
        operation: 'provider.complete',
        context: { provider: this.name, model, status: response.status },
      });
    }
    return response;
  }

  private async parsePayload(response: { ok: boolean; status: number; text(): Promise<string> }): Promise<OpenAiResponsePayload> {
    try {
      return JSON.parse(await response.text()) as OpenAiResponsePayload;
    } catch {
      throw new AiError('OpenAI returned an invalid JSON payload', {
        module: 'ai-orchestrator',
        operation: 'provider.complete',
      });
    }
  }

  private extractText(payload: OpenAiResponsePayload): string {
    const content = payload.choices?.[0]?.message?.content;
    if (content === undefined || content === null) {
      throw new AiError('OpenAI response contained no completion content', {
        module: 'ai-orchestrator',
        operation: 'provider.complete',
      });
    }
    return content;
  }
}

/**
 * Model-provider abstraction. The orchestrator talks to a {@link Provider},
 * never to a concrete vendor, so Anthropic, Gemini, local models, or future
 * providers can be swapped in without touching orchestrator logic.
 */

export type ProviderRole = 'system' | 'user' | 'assistant';

export interface ProviderMessage {
  role: ProviderRole;
  content: string;
}

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderRequest {
  /** Model identifier as understood by the provider, e.g. `gpt-4o-mini`. */
  model: string;
  messages: ProviderMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Provider-specific extras (JSON mode, stop sequences, tools...). */
  options?: Record<string, unknown>;
}

export interface ProviderResponse {
  /** The completion text. May be empty for tool-only responses. */
  text: string;
  usage: ProviderUsage;
  model: string;
  /** Provider-specific raw payload (kept for tracing/debugging). */
  raw?: Record<string, unknown>;
}

export interface ProviderHealth {
  status: 'ok' | 'degraded' | 'down';
  detail?: string;
}

/** A model provider capable of completing chat-style requests. */
export interface Provider {
  readonly name: string;
  readonly models: readonly string[];
  complete(request: ProviderRequest, options?: ProviderCallOptions): Promise<ProviderResponse>;
  checkHealth(): Promise<ProviderHealth>;
}

export interface ProviderCallOptions {
  /** Abort the in-flight call. */
  signal?: AbortSignal;
  /** Provider request timeout. */
  timeoutMs?: number;
}

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'local' | string;

export interface ProviderConfig {
  name: ProviderName;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Additional provider-specific options, e.g. `{ orgId }`. */
  extra?: Record<string, unknown>;
}

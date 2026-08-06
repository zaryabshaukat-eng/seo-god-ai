/**
 * Copilot metrics. The counters use a minimal structural interface so the
 * package works against any registry (monitoring's `MetricsRegistry` or a
 * plain recorder in tests).
 */

import type { ChatUsage } from './types.js';

export interface CopilotMetrics {
  /** A user message was processed. */
  message(): void;
  /** A session was created. */
  session(): void;
  /** A model turn started. */
  turn(): void;
  /** A tool call was executed. */
  toolCall(): void;
  /** A tool call failed. */
  toolError(): void;
  /** A permission check denied a tool call. */
  permissionDenied(): void;
  /** The chat model raised an error. */
  modelError(): void;
  /** Token usage for a completed conversation. */
  tokens(usage: ChatUsage): void;
  /** Model latency for a completed conversation. */
  latency(ms: number): void;
}

export const METRIC_NAMES = {
  messages: 'copilot_messages',
  sessions: 'copilot_sessions',
  turns: 'copilot_turns',
  toolCalls: 'copilot_tool_calls',
  toolErrors: 'copilot_tool_errors',
  permissionDenied: 'copilot_permission_denied',
  modelErrors: 'copilot_model_errors',
  tokens: 'copilot_tokens',
  latency: 'copilot_latency_ms',
} as const;

/** Structural subset of the monitoring registry used by the copilot. */
export interface MetricsRegistryLike {
  increment(name: string, value?: number): void;
  observe(name: string, value: number): void;
}

/** No-op metrics used when monitoring is not configured. */
export class NoopCopilotMetrics implements CopilotMetrics {
  message(): void {}
  session(): void {}
  turn(): void {}
  toolCall(): void {}
  toolError(): void {}
  permissionDenied(): void {}
  modelError(): void {}
  tokens(_usage: ChatUsage): void {}
  latency(_ms: number): void {}
}

/** Adapts a metrics registry into the copilot metrics contract. */
export function fromMetricsRegistry(registry: MetricsRegistryLike): CopilotMetrics {
  return {
    message: () => registry.increment(METRIC_NAMES.messages),
    session: () => registry.increment(METRIC_NAMES.sessions),
    turn: () => registry.increment(METRIC_NAMES.turns),
    toolCall: () => registry.increment(METRIC_NAMES.toolCalls),
    toolError: () => registry.increment(METRIC_NAMES.toolErrors),
    permissionDenied: () => registry.increment(METRIC_NAMES.permissionDenied),
    modelError: () => registry.increment(METRIC_NAMES.modelErrors),
    tokens: (usage) => registry.increment(METRIC_NAMES.tokens, usage.totalTokens),
    latency: (ms) => registry.observe(METRIC_NAMES.latency, ms),
  };
}

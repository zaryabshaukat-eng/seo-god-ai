import { describe, expect, it, vi } from 'vitest';
import { fromMetricsRegistry, METRIC_NAMES, NoopCopilotMetrics } from './metrics.js';
import type { ChatUsage } from './types.js';

describe('NoopCopilotMetrics', () => {
  it('is silent on every method', () => {
    const metrics = new NoopCopilotMetrics();
    expect(() => {
      metrics.message();
      metrics.session();
      metrics.turn();
      metrics.toolCall();
      metrics.toolError();
      metrics.permissionDenied();
      metrics.modelError();
      metrics.tokens({ promptTokens: 1, completionTokens: 1, totalTokens: 2 });
      metrics.latency(12);
    }).not.toThrow();
  });
});

describe('fromMetricsRegistry', () => {
  it('increments counters with the canonical names', () => {
    const increment = vi.fn();
    const observe = vi.fn();
    const metrics = fromMetricsRegistry({ increment, observe });

    metrics.message();
    metrics.session();
    metrics.turn();
    metrics.toolCall();
    metrics.toolError();
    metrics.permissionDenied();
    metrics.modelError();
    metrics.tokens({ promptTokens: 10, completionTokens: 20, totalTokens: 30 } as ChatUsage);
    metrics.latency(42);

    expect(increment).toHaveBeenCalledWith(METRIC_NAMES.messages);
    expect(increment).toHaveBeenCalledWith(METRIC_NAMES.sessions);
    expect(increment).toHaveBeenCalledWith(METRIC_NAMES.turns);
    expect(increment).toHaveBeenCalledWith(METRIC_NAMES.toolCalls);
    expect(increment).toHaveBeenCalledWith(METRIC_NAMES.toolErrors);
    expect(increment).toHaveBeenCalledWith(METRIC_NAMES.permissionDenied);
    expect(increment).toHaveBeenCalledWith(METRIC_NAMES.modelErrors);
    expect(increment).toHaveBeenCalledWith(METRIC_NAMES.tokens, 30);
    expect(observe).toHaveBeenCalledWith(METRIC_NAMES.latency, 42);
  });
});

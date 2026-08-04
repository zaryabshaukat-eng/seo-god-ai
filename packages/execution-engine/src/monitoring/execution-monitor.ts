import type { MetricsRegistry } from '@seogod/monitoring';
import type { ExecutionEvent } from '../types/events.js';

export interface LiveExecutionState {
  executionId: string;
  storeId: string;
  status: string;
  startedAt: number | null;
  completedAt: number | null;
}

const TERMINAL_EVENTS = new Set(['execution.completed', 'execution.failed', 'execution.cancelled', 'execution.rollback_completed']);

/** Subscribes to execution events and mirrors them into counters, gauges and
 * timings, plus a live view of in-flight executions. */
export class ExecutionMonitor {
  private readonly metrics: MetricsRegistry;
  private readonly live = new Map<string, LiveExecutionState>();

  constructor(metrics: MetricsRegistry) {
    this.metrics = metrics;
  }

  handle(event: ExecutionEvent): void {
    this.metrics.increment(`execution.event.${event.type}`);
    if (event.duration !== undefined) {
      this.metrics.observe('execution.duration_ms', event.duration);
    }
    const existing = this.live.get(event.executionId);
    if (existing === undefined) {
      this.live.set(event.executionId, {
        executionId: event.executionId,
        storeId: event.storeId,
        status: event.status ?? 'PENDING',
        startedAt: Date.now(),
        completedAt: null,
      });
    } else {
      existing.status = event.status ?? existing.status;
    }
    if (TERMINAL_EVENTS.has(event.type)) {
      const state = this.live.get(event.executionId);
      if (state !== undefined) state.completedAt = Date.now();
      this.live.delete(event.executionId);
    }
    this.metrics.setGauge('execution.active', this.live.size);
  }

  liveExecutions(): LiveExecutionState[] {
    return [...this.live.values()];
  }

  isActive(executionId: string): boolean {
    return this.live.has(executionId);
  }
}

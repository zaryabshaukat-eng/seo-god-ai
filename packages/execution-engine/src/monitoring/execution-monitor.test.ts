import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '@seogod/monitoring';
import { ExecutionMonitor } from './execution-monitor.js';

describe('ExecutionMonitor', () => {
  it('increments a counter per event type', () => {
    const metrics = new MetricsRegistry();
    const monitor = new ExecutionMonitor(metrics);
    monitor.handle({ type: 'execution.started', executionId: 'e1', storeId: 's1', status: 'EXECUTING' });
    monitor.handle({ type: 'execution.completed', executionId: 'e1', storeId: 's1', status: 'COMPLETED', duration: 15 });
    const snapshot = metrics.snapshot();
    expect(snapshot.counters['execution.event.execution.started']).toBe(1);
    expect(snapshot.counters['execution.event.execution.completed']).toBe(1);
    expect(snapshot.histograms['execution.duration_ms']?.sum).toBe(15);
  });

  it('tracks active executions and removes them at terminal events', () => {
    const metrics = new MetricsRegistry();
    const monitor = new ExecutionMonitor(metrics);
    monitor.handle({ type: 'execution.started', executionId: 'e1', storeId: 's1', status: 'EXECUTING' });
    monitor.handle({ type: 'execution.started', executionId: 'e2', storeId: 's2', status: 'EXECUTING' });
    expect(monitor.isActive('e1')).toBe(true);
    expect(monitor.liveExecutions()).toHaveLength(2);
    expect(metrics.snapshot().gauges['execution.active']).toBe(2);

    monitor.handle({ type: 'execution.completed', executionId: 'e1', storeId: 's1', status: 'COMPLETED' });
    expect(monitor.isActive('e1')).toBe(false);
    expect(monitor.liveExecutions()).toHaveLength(1);
    expect(metrics.snapshot().gauges['execution.active']).toBe(1);
  });

  it('updates the status of a tracked execution', () => {
    const monitor = new ExecutionMonitor(new MetricsRegistry());
    monitor.handle({ type: 'execution.started', executionId: 'e1', storeId: 's1', status: 'EXECUTING' });
    monitor.handle({ type: 'execution.failed', executionId: 'e1', storeId: 's1', status: 'FAILED', error: 'x' });
    expect(monitor.liveExecutions()).toHaveLength(0);
  });

  it('defaults a missing status and keeps it on later statusless events', () => {
    const monitor = new ExecutionMonitor(new MetricsRegistry());
    monitor.handle({ type: 'execution.queued', executionId: 'e1', storeId: 's1' });
    expect(monitor.liveExecutions()[0]?.status).toBe('PENDING');
    monitor.handle({ type: 'execution.started', executionId: 'e1', storeId: 's1' });
    expect(monitor.liveExecutions()[0]?.status).toBe('PENDING');
  });
});

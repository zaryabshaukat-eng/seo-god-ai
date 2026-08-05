import { describe, expect, it } from 'vitest';
import { ExecutionSinkAdapter } from './execution-sink-adapter.js';
import { ObservabilityService } from '../service/observability-service.js';
import { InMemoryObservabilityStore } from '../store/in-memory-observability-store.js';
import { executionEvent } from '../test/helpers.js';

describe('ExecutionSinkAdapter', () => {
  it('forwards execution events into the observability service', async () => {
    const store = new InMemoryObservabilityStore();
    const adapter = new ExecutionSinkAdapter(new ObservabilityService(store));
    await adapter.emit(executionEvent('execution.started'));
    await adapter.emit(executionEvent('execution.completed', { duration: 200 }));

    const record = await store.findExecution('exec-1');
    expect(record?.status).toBe('COMPLETED');
    expect(record?.durationMs).toBe(200);
    expect(await store.listEvents()).toHaveLength(2);
  });
});

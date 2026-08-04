import { describe, expect, it, vi } from 'vitest';
import type { EventBus } from '@seogod/events';
import type { ExecutionEvent } from '../types/events.js';
import { EventBusSink, InMemorySink } from './event-publisher.js';

describe('InMemorySink', () => {
  it('collects emitted events', async () => {
    const sink = new InMemorySink();
    const event: ExecutionEvent = {
      type: 'execution.started',
      executionId: 'e1',
      storeId: 's1',
      status: 'EXECUTING',
    };
    await sink.emit(event);
    expect(sink.events).toHaveLength(1);
    expect(sink.eventsOf('execution.started')).toHaveLength(1);
    expect(sink.eventsOf('execution.completed')).toHaveLength(0);
  });

  it('clears collected events', async () => {
    const sink = new InMemorySink();
    await sink.emit({
      type: 'execution.queued',
      executionId: 'e1',
      storeId: 's1',
      status: 'PENDING',
    });
    sink.clear();
    expect(sink.events).toHaveLength(0);
  });
});

describe('EventBusSink', () => {
  it('publishes an event to the outbox bus', async () => {
    const publish = vi.fn().mockResolvedValue({ id: 'outbox-1' });
    const bus = { publish } as unknown as EventBus;
    const sink = new EventBusSink(bus);
    const event: ExecutionEvent = {
      type: 'execution.completed',
      executionId: 'e1',
      storeId: 's1',
      duration: 12,
      status: 'COMPLETED',
    };
    await sink.emit(event);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'execution.completed',
        aggregateType: 'execution',
        aggregateId: 'e1',
        payload: expect.objectContaining({ executionId: 'e1', duration: 12 }),
      }),
    );
  });

  it('supports a custom aggregate type', async () => {
    const publish = vi.fn().mockResolvedValue({ id: 'outbox-1' });
    const bus = { publish } as unknown as EventBus;
    const sink = new EventBusSink(bus, { aggregateType: 'seo-run' });
    await sink.emit({
      type: 'execution.failed',
      executionId: 'e1',
      storeId: 's1',
      status: 'FAILED',
      error: 'boom',
    });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ aggregateType: 'seo-run' }));
  });
});

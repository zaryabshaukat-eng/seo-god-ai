import type { Prisma } from '@prisma/client';
import type { EventBus } from '@seogod/events';
import type { ExecutionEvent, ExecutionSink } from '../types/events.js';

function toJson(event: ExecutionEvent): Prisma.InputJsonValue {
  const base: Record<string, unknown> = { ...event };
  return base as unknown as Prisma.InputJsonValue;
}

/** Adapts the execution engine to the transactional-outbox {@link EventBus}. */
export class EventBusSink implements ExecutionSink {
  constructor(
    private readonly bus: EventBus,
    private readonly options: { aggregateType?: string } = {},
  ) {}

  async emit(event: ExecutionEvent): Promise<void> {
    await this.bus.publish({
      type: event.type,
      aggregateType: this.options.aggregateType ?? 'execution',
      aggregateId: event.executionId,
      payload: toJson(event),
    });
  }
}

/** In-memory sink used by tests and dry-runs. */
export class InMemorySink implements ExecutionSink {
  readonly events: ExecutionEvent[] = [];

  async emit(event: ExecutionEvent): Promise<void> {
    this.events.push(event);
  }

  eventsOf(type: ExecutionEvent['type']): ExecutionEvent[] {
    return this.events.filter((event) => event.type === type);
  }

  clear(): void {
    this.events.length = 0;
  }
}

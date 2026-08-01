import { Prisma, type OutboxEvent, type PrismaClient } from '@prisma/client';
import { ValidationError } from '@seogod/core';

export interface EventInput {
  /** Dot-separated event type, e.g. `crawl.completed`, `store.installed`. */
  type: string;
  aggregateType?: string;
  aggregateId?: string;
  payload?: Prisma.InputJsonValue;
}

export interface EventBusOptions {
  /** Maximum delivery attempts before an event is marked FAILED. */
  maxAttempts?: number;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

export type EventHandler = (event: OutboxEvent) => Promise<void> | void;

const EVENT_TYPE_PATTERN = /^[a-z0-9]+(\.[a-z0-9]+)+$/;

function validateEventType(type: string): void {
  if (!EVENT_TYPE_PATTERN.test(type)) {
    throw new ValidationError(
      `Event type "${type}" must be dot-separated lowercase, e.g. "crawl.completed"`,
      { module: 'events', operation: 'event.publish' },
    );
  }
}

/**
 * Transactional-outbox event bus. `publish` persists the event in the same
 * datastore the domain writes to, guaranteeing at-least-once delivery;
 * `processNext` dispatches due events to subscribed handlers and tracks
 * attempts with exponential backoff before giving up.
 */
export class EventBus {
  private readonly maxAttempts: number;
  private readonly now: () => Date;
  private readonly handlers = new Map<string, Set<EventHandler>>();

  constructor(
    private readonly prisma: PrismaClient,
    options: EventBusOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.now = options.now ?? (() => new Date());
  }

  /** Registers a handler for an event type. Multiple handlers are allowed. */
  subscribe(type: string, handler: EventHandler): void {
    validateEventType(type);
    const handlers = this.handlers.get(type) ?? new Set<EventHandler>();
    handlers.add(handler);
    this.handlers.set(type, handlers);
  }

  /** Publishes a single event into the outbox. */
  async publish(input: EventInput): Promise<OutboxEvent> {
    validateEventType(input.type);
    return this.prisma.outboxEvent.create({
      data: {
        type: input.type,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload ?? Prisma.JsonNull,
        nextAttemptAt: this.now(),
      },
    });
  }

  /** Publishes several events atomically-ish (one insert per event). */
  async publishMany(inputs: EventInput[]): Promise<OutboxEvent[]> {
    const events: OutboxEvent[] = [];
    for (const input of inputs) {
      events.push(await this.publish(input));
    }
    return events;
  }

  /**
   * Claims and dispatches up to `batchSize` due events. Returns the number
   * of events processed (whether delivered, retried, or failed).
   */
  async processNext(batchSize = 100): Promise<number> {
    const now = this.now();
    const due = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });
    if (due.length === 0) return 0;

    const ids = due.map((event) => event.id);
    const claimed = await this.prisma.outboxEvent.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count === 0) return 0;

    for (const event of due) {
      await this.dispatch(event);
    }
    return due.length;
  }

  private async dispatch(event: OutboxEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (handlers === undefined || handlers.size === 0) {
      await this.markDone(event.id);
      return;
    }
    try {
      for (const handler of handlers) {
        await handler(event);
      }
      await this.markDone(event.id);
    } catch {
      await this.markFailed(event);
    }
  }

  private async markDone(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'DONE', processedAt: this.now() },
    });
  }

  private async markFailed(event: OutboxEvent): Promise<void> {
    const attempts = event.attempts + 1;
    if (attempts >= this.maxAttempts) {
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED', attempts },
      });
      return;
    }
    const backoffMs = 2 ** attempts * 1000;
    await this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: 'PENDING',
        attempts,
        nextAttemptAt: new Date(this.now().getTime() + backoffMs),
      },
    });
  }
}

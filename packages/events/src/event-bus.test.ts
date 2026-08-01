import { describe, expect, it, vi } from 'vitest';
import type { OutboxEvent, PrismaClient } from '@prisma/client';
import { ValidationError } from '@seogod/core';
import { EventBus } from './event-bus.js';

function makeEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: `evt-${Math.random()}`,
    type: 'crawl.completed',
    aggregateType: null,
    aggregateId: null,
    payload: null,
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    processedAt: null,
    ...overrides,
  };
}

function makeFakePrisma(): { prisma: PrismaClient; events: OutboxEvent[] } {
  const events: OutboxEvent[] = [];
  const prisma = {
    outboxEvent: {
      create: async (args: {
        data: Partial<OutboxEvent>;
      }): Promise<OutboxEvent> => {
        const event = makeEvent({ ...(args.data as Partial<OutboxEvent>) });
        events.push(event);
        return event;
      },
      findMany: async (args: {
        where: { status: string; nextAttemptAt?: { lte: Date } };
        orderBy?: unknown;
        take?: number;
      }): Promise<OutboxEvent[]> =>
        [...events]
          .filter((event) => {
            if (event.status !== args.where.status) return false;
            const lte = args.where.nextAttemptAt?.lte;
            if (lte !== undefined && event.nextAttemptAt > lte) return false;
            return true;
          })
          .slice(0, args.take),
      updateMany: async (args: {
        where: { id?: { in: string[] }; status?: string };
        data: Partial<OutboxEvent>;
      }): Promise<{ count: number }> => {
        const ids = args.where.id?.in;
        let count = 0;
        for (const event of events) {
          const match =
            ids === undefined ? event.status === args.where.status : ids.includes(event.id);
          if (match && event.status === 'PENDING') {
            Object.assign(event, args.data);
            count += 1;
          }
        }
        return { count };
      },
      update: async (args: {
        where: { id: string };
        data: Partial<OutboxEvent>;
      }): Promise<OutboxEvent> => {
        const index = events.findIndex((event) => event.id === args.where.id);
        if (index === -1) throw new Error('Record not found');
        events[index] = { ...events[index] as OutboxEvent, ...args.data };
        return events[index] as OutboxEvent;
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, events };
}

const FIXED_NOW = new Date('2026-01-02T00:00:00Z');

describe('EventBus', () => {
  it('publishes an event into the outbox', async () => {
    const { prisma, events } = makeFakePrisma();
    const bus = new EventBus(prisma, { now: () => FIXED_NOW });
    const event = await bus.publish({ type: 'store.installed', aggregateId: 'store-1' });
    expect(event.status).toBe('PENDING');
    expect(event.aggregateId).toBe('store-1');
    expect(events).toHaveLength(1);
  });

  it('publishes many events', async () => {
    const { prisma, events } = makeFakePrisma();
    const bus = new EventBus(prisma, { now: () => FIXED_NOW });
    await bus.publishMany([
      { type: 'crawl.completed' },
      { type: 'crawl.completed' },
    ]);
    expect(events).toHaveLength(2);
  });

  it('rejects malformed event types on publish and subscribe', () => {
    const { prisma } = makeFakePrisma();
    const bus = new EventBus(prisma, { now: () => FIXED_NOW });
    expect(() => bus.subscribe('NotAValidType', vi.fn())).toThrow(ValidationError);
    expect(() => bus.subscribe('', vi.fn())).toThrow(ValidationError);
  });

  it('dispatches due events to subscribed handlers and marks them DONE', async () => {
    const { prisma, events } = makeFakePrisma();
    const bus = new EventBus(prisma, { now: () => FIXED_NOW });
    const handler = vi.fn();
    bus.subscribe('crawl.completed', handler);
    await bus.publish({ type: 'crawl.completed', payload: { pages: 42 } });

    const processed = await bus.processNext();
    expect(processed).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].payload).toEqual({ pages: 42 });
    expect(events[0]?.status).toBe('DONE');
    expect(events[0]?.processedAt).toEqual(FIXED_NOW);
  });

  it('retries failed handlers with incremented attempts', async () => {
    const { prisma, events } = makeFakePrisma();
    const bus = new EventBus(prisma, { now: () => FIXED_NOW, maxAttempts: 5 });
    bus.subscribe('crawl.completed', () => {
      throw new Error('boom');
    });
    await bus.publish({ type: 'crawl.completed' });

    await bus.processNext();
    expect(events[0]?.status).toBe('PENDING');
    expect(events[0]?.attempts).toBe(1);
    expect(events[0]?.nextAttemptAt.getTime()).toBeGreaterThan(FIXED_NOW.getTime());
  });

  it('marks events FAILED once max attempts are reached', async () => {
    const { prisma, events } = makeFakePrisma();
    const bus = new EventBus(prisma, { now: () => FIXED_NOW, maxAttempts: 2 });
    bus.subscribe('crawl.completed', () => {
      throw new Error('boom');
    });
    await bus.publish({ type: 'crawl.completed' });

    await bus.processNext();
    expect(events[0]?.attempts).toBe(1);

    events[0] = { ...events[0] as OutboxEvent, nextAttemptAt: FIXED_NOW };
    await bus.processNext();
    expect(events[0]?.status).toBe('FAILED');
    expect(events[0]?.attempts).toBe(2);
  });

  it('marks events without handlers as DONE', async () => {
    const { prisma, events } = makeFakePrisma();
    const bus = new EventBus(prisma, { now: () => FIXED_NOW });
    await bus.publish({ type: 'crawl.completed' });
    await bus.processNext();
    expect(events[0]?.status).toBe('DONE');
  });

  it('does not process events that are not yet due', async () => {
    const { prisma } = makeFakePrisma();
    const bus = new EventBus(prisma, { now: () => FIXED_NOW });
    const handler = vi.fn();
    bus.subscribe('crawl.completed', handler);
    await prisma.outboxEvent.create({
      data: makeEvent({
        nextAttemptAt: new Date(FIXED_NOW.getTime() + 60_000),
      }) as never,
    });
    const processed = await bus.processNext();
    expect(processed).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('honors the batch size', async () => {
    const { prisma } = makeFakePrisma();
    const bus = new EventBus(prisma, { now: () => FIXED_NOW });
    const handler = vi.fn();
    bus.subscribe('crawl.completed', handler);
    await bus.publishMany([{ type: 'crawl.completed' }, { type: 'crawl.completed' }]);
    await bus.processNext(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

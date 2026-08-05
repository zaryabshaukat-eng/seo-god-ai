import { describe, expect, it } from 'vitest';
import type { OutboxEvent } from '@prisma/client';
import { EventBusConsumer, DEFAULT_CONSUMED_TYPES } from './event-bus-consumer.js';
import { ObservabilityService } from '../service/observability-service.js';
import { InMemoryObservabilityStore } from '../store/in-memory-observability-store.js';

type Handler = (event: OutboxEvent) => Promise<void> | void;

class FakeBus {
  readonly handlers = new Map<string, Handler[]>();

  subscribe(type: string, handler: Handler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  async emit(type: string, payload: unknown): Promise<void> {
    const outbox = {
      id: 'outbox-1',
      type,
      aggregateType: null,
      aggregateId: null,
      payload,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      processedAt: null,
    } as unknown as OutboxEvent;
    for (const handler of this.handlers.get(type) ?? []) {
      await handler(outbox);
    }
  }
}

interface Harness {
  bus: FakeBus;
  store: InMemoryObservabilityStore;
  service: ObservabilityService;
}

function make(): Harness {
  const bus = new FakeBus();
  const store = new InMemoryObservabilityStore();
  const service = new ObservabilityService(store);
  return { bus, store, service };
}

describe('EventBusConsumer', () => {
  it('subscribes to every default consumed type on attach', () => {
    const { bus, service } = make();
    new EventBusConsumer(bus, service).attach();
    for (const type of DEFAULT_CONSUMED_TYPES) {
      expect(bus.handlers.has(type)).toBe(true);
      expect(bus.handlers.get(type)?.length).toBe(1);
    }
  });

  it('subscribes to only the configured types', () => {
    const { bus, service } = make();
    new EventBusConsumer(bus, service, { types: ['crawl.completed'] }).attach();
    expect(bus.handlers.has('crawl.completed')).toBe(true);
    expect(bus.handlers.has('crawl.failed')).toBe(false);
  });

  it('routes crawl events, ignoring events without a store id', async () => {
    const { bus, store, service } = make();
    new EventBusConsumer(bus, service).attach();
    await bus.emit('crawl.completed', { storeId: 'store-1', statistics: { pagesCrawled: 5 } });
    await bus.emit('crawl.failed', { storeId: 'store-1', error: 'timeout' });
    await bus.emit('crawl.completed', {});
    await bus.emit('crawl.failed', {});

    const events = await store.listEvents();
    expect(events.map((e) => e.type)).toEqual(['crawl.failed', 'crawl.completed']);
    expect(events).toHaveLength(2);
  });

  it('routes SEO analysis payloads and rehydrates optional fields', async () => {
    const { bus, store, service } = make();
    new EventBusConsumer(bus, service).attach();
    await bus.emit('seo.analysis.completed', {
      storeId: 'store-1',
      overallScore: 82,
      scores: { title: 82 },
      issues: [{ category: 'meta', count: 3 }],
      recommendationsCount: 4,
      reference: 'AFTER',
      executionId: 'exec-1',
      crawlJobId: 'crawl-1',
      analyzedAt: '2026-01-01T00:00:00.000Z',
    });
    await bus.emit('seo.analysis.completed', { storeId: 'store-1', overallScore: 'high' });
    await bus.emit('seo.analysis.completed', {});
    await bus.emit('seo.analysis.completed', { storeId: 'store-1', overallScore: 50, scores: 'x', issues: 'x', recommendationsCount: 'x', reference: 'SIDEWAYS' });

    const snapshots = await store.listSnapshots();
    expect(snapshots).toHaveLength(3);
    expect(snapshots[0]?.overallScore).toBe(50);
    expect(snapshots[0]?.reference).toBeUndefined();
    expect(snapshots[1]?.overallScore).toBe(0);
    expect(snapshots[2]).toMatchObject({ overallScore: 82, reference: 'AFTER', executionId: 'exec-1', crawlJobId: 'crawl-1' });
  });

  it('routes validation failures with code filtering', async () => {
    const { bus, store, service } = make();
    new EventBusConsumer(bus, service).attach();
    await bus.emit('validation.failed', { executionId: 'exec-1', storeId: 'store-1', codes: ['schema', 'missing'] });
    await bus.emit('validation.failed', { codes: [42, 'schema'] });

    const events = await store.listEvents();
    expect(events).toHaveLength(2);
    const routed = events[1]?.event;
    expect(routed?.type).toBe('validation.failed');
  });

  it('routes execution events into execution records', async () => {
    const { bus, store, service } = make();
    new EventBusConsumer(bus, service).attach();
    await bus.emit('execution.queued', { type: 'execution.queued', executionId: 'exec-1', storeId: 'store-1', operation: 'seo.update_title' });
    await bus.emit('execution.completed', { type: 'execution.completed', executionId: 'exec-1', storeId: 'store-1', operation: 'seo.update_title', duration: 100 });

    const record = await store.findExecution('exec-1');
    expect(record?.status).toBe('COMPLETED');
    expect(record?.durationMs).toBe(100);
  });

  it('ignores unknown event types and malformed payloads', async () => {
    const { bus, store, service } = make();
    new EventBusConsumer(bus, service).attach();
    await bus.emit('store.installed', { storeId: 'store-1' });
    await bus.emit('crawl.completed', null);
    await bus.emit('crawl.completed', [1, 2]);
    await bus.emit('crawl.completed', 'nope');

    expect(await store.listEvents()).toHaveLength(0);
    expect(await store.listSnapshots()).toHaveLength(0);
  });
});

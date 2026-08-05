import { describe, expect, it } from 'vitest';
import type { EventInput, EventBus } from '@seogod/events';
import { EventBusPublisher, GOOGLE_EVENT_TYPES, type GoogleEventInput } from './events.js';

describe('EventBusPublisher', () => {
  it('adapts package events to the outbox event shape', async () => {
    const published: EventInput[] = [];
    const bus: Pick<EventBus, 'publish'> = {
      publish: async (input: EventInput) => {
        published.push(input);
        return input as never;
      },
    };

    const publisher = new EventBusPublisher(bus);
    const input: GoogleEventInput = {
      type: 'google.searchconsole.synced',
      provider: 'search-console',
      resource: 'sc-domain:example.com',
      payload: { rowCount: 3 },
    };
    await publisher.publish(input);

    expect(published[0]).toMatchObject({
      type: 'google.searchconsole.synced',
      aggregateType: 'google',
      aggregateId: 'search-console:sc-domain:example.com',
      payload: { rowCount: 3 },
    });
  });

  it('uses an explicit aggregateId when provided', async () => {
    const published: EventInput[] = [];
    const publisher = new EventBusPublisher({
      publish: async (input: EventInput) => {
        published.push(input);
        return input as never;
      },
    });
    await publisher.publish({
      type: 'google.analytics.synced',
      provider: 'analytics',
      resource: '12345',
      aggregateId: 'run-1',
    });
    expect(published[0]?.aggregateId).toBe('run-1');
  });

  it('declares event types that satisfy the outbox dot-separated pattern', () => {
    const pattern = /^[a-z0-9]+(\.[a-z0-9]+)+$/;
    expect(GOOGLE_EVENT_TYPES.length).toBeGreaterThan(0);
    for (const type of GOOGLE_EVENT_TYPES) {
      expect(type).toMatch(pattern);
    }
  });
});

/**
 * Tests for the real-time layer: the in-memory hub semantics, the event-bus
 * wiring bridge and the SSE + publish HTTP endpoints over a live server.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { EventBus } from '@seogod/events';
import { boot, register, api, stopQuietly, type Harness } from '../test/harness.js';
import { RealtimeHub, wireRealtimeToEventBus } from './realtime.js';

describe('realtime hub', () => {
  it('subscribes, publishes, replays history and unsubscribes', () => {
    const hub = new RealtimeHub({ now: () => '2026-01-15T12:00:00.000Z' });
    const seen: unknown[] = [];
    const unsubscribe = hub.subscribe('crawls', (event) => seen.push(event.payload));
    hub.publish('crawls', 'a');
    hub.publish('crawls', 'b');
    hub.publish('other', 'ignored');

    expect(seen).toEqual(['a', 'b']);
    expect(hub.channels()).toEqual(['crawls']);
    expect(hub.subscribers('crawls')).toBe(1);
    expect(hub.recent('crawls')).toHaveLength(2);
    expect(hub.recent('crawls')[0]?.publishedAt).toBe('2026-01-15T12:00:00.000Z');

    unsubscribe();
    expect(hub.subscribers('crawls')).toBe(0);
    expect(hub.channels()).toEqual([]);
  });

  it('caps history and clears state', () => {
    const hub = new RealtimeHub();
    for (let index = 0; index < 60; index += 1) {
      hub.publish('c', index);
    }
    expect(hub.recent('c')).toHaveLength(50);
    expect(hub.recent('c')[0]?.payload).toBe(10);
    expect(hub.recent('c', 2)).toHaveLength(2);
    hub.clear();
    expect(hub.recent('c')).toEqual([]);
  });

  it('unsubscribeChannel removes every handler', () => {
    const hub = new RealtimeHub();
    hub.subscribe('c', () => {});
    hub.subscribe('c', () => {});
    hub.subscribe('d', () => {});
    expect(hub.subscribers('c')).toBe(2);
    hub.unsubscribeChannel('c');
    expect(hub.subscribers('c')).toBe(0);
    expect(hub.subscribers('d')).toBe(1);
  });

  it('unsubscribing from an unknown channel is a no-op', () => {
    const hub = new RealtimeHub();
    hub.unsubscribe('missing', () => {});
    expect(hub.channels()).toEqual([]);
    expect(hub.subscribers('missing')).toBe(0);
  });
});

describe('realtime wiring', () => {
  it('forwards crawl lifecycle events from the bus to the hub', async () => {
    const hub = new RealtimeHub();
    const received: unknown[] = [];
    hub.subscribe('crawls', (event) => received.push(event.payload));

    const captured: Array<{ type: string; handler: (event: unknown) => void }> = [];
    const bus = {
      subscribe(type: string, handler: (event: unknown) => void) {
        captured.push({ type, handler });
      },
    } as unknown as EventBus;

    const cleanup = wireRealtimeToEventBus(hub, bus);
    expect(captured.map((entry) => entry.type)).toEqual(['crawl.completed', 'crawl.failed']);

    const event = { type: 'crawl.completed', id: 'evt_1', aggregateId: 'job_1', aggregateType: 'crawlJob', payload: { pages: 5 } };
    captured[0]?.handler(event);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'crawl.completed', aggregateId: 'job_1', payload: { pages: 5 } });

    cleanup();
  });
});

interface OpenStream {
  close: () => Promise<void>;
  read: (marker: string) => Promise<string>;
}

async function openStream(harness: Harness, query: string, token: string): Promise<OpenStream> {
  const response = await fetch(`${harness.baseUrl}/api/v1/realtime/events?${query}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    close: async () => {
      await reader.cancel().catch(() => undefined);
    },
    read: async (marker: string) => {
      const deadline = Date.now() + 8000;
      while (!buffer.includes(marker)) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for '${marker}'; buffer so far: ${buffer}`);
        }
        const { value, done } = await reader.read();
        if (done) return buffer;
        buffer += decoder.decode(value, { stream: true });
      }
      return buffer;
    },
  };
}

describe('realtime routes', () => {
  let h: Harness;

  afterEach(async () => {
    await stopQuietly(h);
  });

  it('replays channel history and pushes live events over SSE', async () => {
    h = await boot();
    const { token } = await register(h, { email: 'rt@example.com' });

    const publish = await api(h, '/api/v1/realtime/publish', {
      method: 'POST',
      token,
      body: { channel: 'crawls', payload: { ok: true } },
    });
    expect(publish.status).toBe(200);
    expect((publish.body as any).channel).toBe('crawls');

    const stream = await openStream(h, 'channel=crawls', token);
    try {
      const replayed = await stream.read('{"ok":true}');
      expect(replayed).toContain('event: crawls');
      expect(replayed).toContain('retry: 3000');

      await api(h, '/api/v1/realtime/publish', {
        method: 'POST',
        token,
        body: { channel: 'crawls', payload: { live: 2 } },
      });
      const pushed = await stream.read('{"live":2}');
      expect(pushed).toContain('event: crawls');
    } finally {
      await stream.close();
    }
  });

  it('subscribes to every channel when no channel is given', async () => {
    h = await boot();
    const { token } = await register(h, { email: 'rtwild@example.com' });
    const stream = await openStream(h, '', token);
    try {
      await api(h, '/api/v1/realtime/publish', {
        method: 'POST',
        token,
        body: { channel: 'anything', payload: { wild: true } },
      });
      expect(await stream.read('{"wild":true}')).toContain('event: anything');
    } finally {
      await stream.close();
    }
  });

  it('requires auth on the SSE stream and on publish', async () => {
    h = await boot();
    const anonStream = await fetch(`${h.baseUrl}/api/v1/realtime/events`);
    expect(anonStream.status).toBe(401);
    await anonStream.body?.cancel();

    const anonPublish = await api(h, '/api/v1/realtime/publish', { method: 'POST', body: { channel: 'c', payload: {} } });
    expect(anonPublish.status).toBe(401);
  });

  it('validates the publish body', async () => {
    h = await boot();
    const { token } = await register(h, { email: 'rtvalid@example.com' });
    const missingChannel = await api(h, '/api/v1/realtime/publish', { method: 'POST', token, body: { payload: {} } });
    expect(missingChannel.status).toBe(400);

    const noBody = await api(h, '/api/v1/realtime/publish', { method: 'POST', token });
    expect(noBody.status).toBe(400);
  });
});

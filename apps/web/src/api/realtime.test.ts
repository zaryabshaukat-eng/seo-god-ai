import { describe, expect, it, vi } from 'vitest';
import { createRealtime } from './realtime.js';
import type { RealtimeTransport } from '../types.js';

interface FakeTransport extends RealtimeTransport {
  emit(channel: string, payload: unknown): void;
  sent: Array<{ channel: string; payload: unknown }>;
  connectImpl: ReturnType<typeof vi.fn>;
}

function makeTransport(): FakeTransport {
  let handler: ((channel: string, payload: unknown) => void) | undefined;
  let impl = vi.fn(async () => undefined);
  const sent: Array<{ channel: string; payload: unknown }> = [];
  return {
    get connectImpl() {
      return impl;
    },
    set connectImpl(next) {
      impl = next;
    },
    sent,
    connect: () => impl(),
    disconnect: vi.fn(),
    onMessage(fn) {
      handler = fn;
    },
    send(channel, payload) {
      sent.push({ channel, payload });
    },
    emit(channel, payload) {
      handler?.(channel, payload);
    },
  };
}

describe('createRealtime', () => {
  it('connects and reports the status through listeners', async () => {
    const transport = makeTransport();
    const client = createRealtime({ transport });
    const onStatus = vi.fn();
    client.onStatus(onStatus);
    await client.connect();
    expect(transport.connectImpl).toHaveBeenCalledOnce();
    expect(client.status).toBe('connected');
    expect(onStatus).toHaveBeenCalledWith('connected');
  });

  it('does not reconnect while connecting or connected', async () => {
    const transport = makeTransport();
    const client = createRealtime({ transport });
    await client.connect();
    await client.connect();
    expect(transport.connectImpl).toHaveBeenCalledTimes(1);
  });

  it('publishes locally and to the transport', () => {
    const transport = makeTransport();
    const client = createRealtime({ transport });
    const listener = vi.fn();
    client.subscribe('crawl:1', listener);
    client.publish('crawl:1', { pages: 5 });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.payload).toEqual({ pages: 5 });
    expect(listener).toHaveBeenCalledWith({ pages: 5 });
  });

  it('forwards inbound transport messages to channel subscribers', () => {
    const transport = makeTransport();
    const client = createRealtime({ transport });
    const listener = vi.fn();
    client.subscribe('alerts', listener);
    transport.emit('alerts', { severity: 'high' });
    expect(listener).toHaveBeenCalledWith({ severity: 'high' });
  });

  it('does not notify when there are no subscribers', () => {
    const transport = makeTransport();
    const client = createRealtime({ transport });
    const listener = vi.fn();
    client.subscribe('other', listener);
    transport.emit('missing', {});
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribes individual handlers and prunes empty channels', () => {
    const transport = makeTransport();
    const client = createRealtime({ transport });
    const a = vi.fn();
    const b = vi.fn();
    const offA = client.subscribe('x', a);
    const offB = client.subscribe('x', b);
    offA();
    transport.emit('x', 1);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    offB();
    expect(client.channels()).toEqual([]);
  });

  it('clears all subscriptions for a channel', () => {
    const transport = makeTransport();
    const client = createRealtime({ transport });
    const listener = vi.fn();
    client.subscribe('y', listener);
    client.unsubscribe('y');
    transport.emit('y', 1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('lists subscribed channels', () => {
    const transport = makeTransport();
    const client = createRealtime({ transport });
    client.subscribe('a', () => undefined);
    client.subscribe('b', () => undefined);
    expect(client.channels().sort()).toEqual(['a', 'b']);
  });

  it('disconnects and clears the status', () => {
    const transport = makeTransport();
    const client = createRealtime({ transport });
    const onStatus = vi.fn();
    client.onStatus(onStatus);
    client.disconnect();
    expect(transport.disconnect).toHaveBeenCalledOnce();
    expect(client.status).toBe('disconnected');
  });

  it('reconnects after a failed attempt', async () => {
    vi.useFakeTimers();
    try {
      const transport = makeTransport();
      let calls = 0;
      transport.connectImpl = vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('down');
        }
      });
      const client = createRealtime({ transport, reconnectDelayMs: 10, maxReconnectAttempts: 5 });
      const promise = client.connect();
      await vi.advanceTimersByTimeAsync(10);
      await promise;
      expect(client.status).toBe('connected');
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after the maximum reconnect attempts', async () => {
    vi.useFakeTimers();
    try {
      const transport = makeTransport();
      transport.connectImpl = vi.fn(async () => {
        throw new Error('down');
      });
      const client = createRealtime({ transport, reconnectDelayMs: 10, maxReconnectAttempts: 2 });
      const promise = client.connect();
      await vi.advanceTimersByTimeAsync(10 * 1 + 10 * 2);
      await promise;
      expect(client.status).toBe('disconnected');
      expect(transport.connectImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops reconnecting after disconnect', async () => {
    vi.useFakeTimers();
    try {
      const transport = makeTransport();
      transport.connectImpl = vi.fn(async () => {
        throw new Error('down');
      });
      const client = createRealtime({ transport, reconnectDelayMs: 10, maxReconnectAttempts: 10 });
      const promise = client.connect();
      client.disconnect();
      await vi.advanceTimersByTimeAsync(100);
      await promise;
      expect(transport.connectImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not schedule a reconnect after disposal mid-connect', async () => {
    vi.useFakeTimers();
    try {
      const transport = makeTransport();
      transport.connectImpl = vi.fn(async () => {
        throw new Error('down');
      });
      const client = createRealtime({ transport });
      const promise = client.connect();
      await vi.advanceTimersByTimeAsync(1);
      client.disconnect();
      await promise;
      expect(client.status).toBe('disconnected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reconnect after disposal', async () => {
    const transport = makeTransport();
    const client = createRealtime({ transport });
    client.disconnect();
    await client.connect();
    expect(transport.connectImpl).not.toHaveBeenCalled();
    expect(client.status).toBe('disconnected');
  });

  it('stays disconnected when disposal happens mid-connect', async () => {
    const transport = makeTransport();
    let resolveConnect: (() => void) | undefined;
    transport.connectImpl = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    const client = createRealtime({ transport });
    const promise = client.connect();
    client.disconnect();
    resolveConnect?.();
    await promise;
    expect(transport.disconnect).toHaveBeenCalledOnce();
    expect(client.status).toBe('disconnected');
  });

  it('removes status listeners on unsubscribe', async () => {
    const transport = makeTransport();
    const client = createRealtime({ transport });
    const onStatus = vi.fn();
    const off = client.onStatus(onStatus);
    off();
    await client.connect();
    expect(onStatus).not.toHaveBeenCalled();
  });
});

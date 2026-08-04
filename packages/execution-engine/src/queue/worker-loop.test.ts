import { describe, expect, it } from 'vitest';
import { InMemoryQueueStore } from './queue-store.js';
import { buildRetryPolicy } from './retry-policy.js';
import { WorkerLoop } from './worker-loop.js';

describe('worker loop', () => {
  it('does nothing when not running', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1);
    const loop = new WorkerLoop({
      store,
      worker: async () => {},
      retryPolicy: buildRetryPolicy(),
    });
    expect(await loop.runOnce()).toBe(false);
    expect(loop.isRunning()).toBe(false);
    loop.start();
    expect(loop.isRunning()).toBe(true);
    expect(await loop.runOnce()).toBe(true);
    expect(store.wasCancelled('anything')).toBe(false);
  });

  it('completes entries that succeed', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1);
    const seen: number[] = [];
    const loop = new WorkerLoop({
      store,
      worker: async (payload) => {
        seen.push(payload);
      },
      retryPolicy: buildRetryPolicy(),
    });
    loop.start();
    expect(await loop.runOnce()).toBe(true);
    expect(seen).toEqual([1]);
    expect((await store.list())[0]!.status).toBe('SUCCEEDED');
  });

  it('retries failures with backoff and dead-letters when exhausted', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1, { maxAttempts: 3 });
    let now = 0;
    let calls = 0;
    const loop = new WorkerLoop({
      store,
      worker: async () => {
        calls += 1;
        throw new Error('boom');
      },
      retryPolicy: buildRetryPolicy({ maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 10 }),
      sleepFn: async () => {},
      nowMs: () => now,
    });
    loop.start();
    await loop.runOnce();
    expect((await store.list())[0]!.status).toBe('QUEUED');
    now = 10;
    await loop.runOnce();
    expect((await store.list())[0]!.status).toBe('QUEUED');
    now = 20;
    await loop.runOnce();
    expect((await store.list())[0]!.status).toBe('DEAD');
    expect(calls).toBe(3);
  });

  it('drops in-flight entries that were cancelled while running', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1);
    const loop = new WorkerLoop({
      store,
      worker: async (_payload, entry) => {
        await store.cancel(entry.id);
      },
      retryPolicy: buildRetryPolicy(),
    });
    loop.start();
    await loop.runOnce();
    const entry = (await store.list())[0]!;
    expect(entry.status).toBe('CLAIMED');
    expect(store.wasCancelled(entry.id)).toBe(true);
  });

  it('stringifies non-Error handler failures', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1, { maxAttempts: 1 });
    const loop = new WorkerLoop({
      store,
      worker: async () => {
        throw 'boom';
      },
      retryPolicy: buildRetryPolicy({ maxAttempts: 1 }),
      sleepFn: async () => {},
      nowMs: () => 0,
    });
    loop.start();
    await loop.runOnce();
    const entry = (await store.list())[0]!;
    expect(entry.status).toBe('DEAD');
    expect(entry.lastError).toBe('boom');
  });
});

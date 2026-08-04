import { describe, expect, it } from 'vitest';
import { InMemoryQueueStore } from './queue-store.js';
import { WorkerPool } from './worker-pool.js';

describe('worker pool', () => {
  it('pump processes up to concurrency entries and reports whether work happened', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1);
    await store.enqueuePayload(2);
    await store.enqueuePayload(3);
    const seen: number[] = [];
    const pool = new WorkerPool<number>(
      store,
      async (payload) => {
        seen.push(payload);
      },
      { concurrency: 2, sleepFn: async () => {}, nowMs: () => 0 },
    );
    try {
      pool.start();
      let worked = 0;
      while (await pool.pump()) {
        worked += 1;
        if (worked > 10) break;
      }
      expect(worked).toBeGreaterThan(0);
      expect(seen).toHaveLength(3);
      expect(seen.slice().sort()).toEqual([1, 2, 3]);
      expect((await store.list()).every((entry) => entry.status === 'SUCCEEDED')).toBe(true);
    } finally {
      await pool.stop();
    }
  });

  it('waitForIdle drains the queue to terminal states', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    for (let i = 1; i <= 5; i += 1) await store.enqueuePayload(i);
    const seen: number[] = [];
    const pool = new WorkerPool<number>(
      store,
      async (payload) => {
        seen.push(payload);
      },
      { concurrency: 3, sleepFn: async () => {}, nowMs: () => 0 },
    );
    try {
      pool.start();
      await pool.waitForIdle();
      const statuses = (await store.list()).map((entry) => entry.status);
      expect(statuses.every((status) => status === 'SUCCEEDED')).toBe(true);
      expect(seen).toHaveLength(5);
    } finally {
      await pool.stop();
    }
  });

  it('dead-letters poisoned messages so the queue can idle', async () => {
    let now = 0;
    const store = new InMemoryQueueStore<number>({ nowMs: () => now });
    await store.enqueuePayload(1, { maxAttempts: 2 });
    const pool = new WorkerPool<number>(
      store,
      async () => {
        throw new Error('poison');
      },
      { concurrency: 1, sleepFn: async () => {}, nowMs: () => now },
    );
    try {
      pool.start();
      let attempts = 0;
      while (attempts < 10 && (await store.list())[0]!.status !== 'DEAD') {
        const worked = await pool.pump();
        if (!worked) now += 1000;
        attempts += 1;
      }
      expect((await store.list())[0]!.status).toBe('DEAD');
    } finally {
      await pool.stop();
    }
  });

  it('waitForIdle throws when the pool was never started', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    const pool = new WorkerPool<number>(store, async () => {}, { concurrency: 1 });
    await expect(pool.waitForIdle()).rejects.toThrow(/started/);
  });

  it('start/stop toggles running state without immediate processing', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    const pool = new WorkerPool<number>(store, async () => {}, { concurrency: 1 });
    expect(pool.isRunning()).toBe(false);
    pool.start();
    expect(pool.isRunning()).toBe(true);
    await pool.stop();
    expect(pool.isRunning()).toBe(false);
    await pool.stop();
    expect(pool.isRunning()).toBe(false);
  });

  it('start is idempotent and pump does nothing before start', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    const pool = new WorkerPool<number>(store, async () => {}, { concurrency: 1 });
    expect(await pool.pump()).toBe(false);
    await store.enqueuePayload(1);
    pool.start();
    pool.start();
    expect(pool.isRunning()).toBe(true);
    await pool.waitForIdle();
    await pool.stop();
  });
});

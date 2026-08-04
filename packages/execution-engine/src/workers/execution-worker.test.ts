import { describe, expect, it, vi } from 'vitest';
import { InMemoryQueueStore } from '../queue/queue-store.js';
import { ExecutionWorker } from './execution-worker.js';

describe('ExecutionWorker', () => {
  it('enqueues a well-formed entry and returns its id', async () => {
    const queue = new InMemoryQueueStore<{ executionId: string }>();
    const worker = new ExecutionWorker({ queue, handler: async () => {} });
    const id = await worker.enqueue({ executionId: 'e1' });
    expect(typeof id).toBe('string');
    const entries = await queue.list();
    expect(entries[0]?.payload).toEqual({ executionId: 'e1' });
    expect(entries[0]?.status).toBe('QUEUED');
    expect(entries[0]?.maxAttempts).toBe(3);
  });

  it('honors priority and delay options', async () => {
    const queue = new InMemoryQueueStore<{ executionId: string }>();
    const worker = new ExecutionWorker({ queue, handler: async () => {} });
    await worker.enqueue({ executionId: 'e1' }, { priority: 5, delayMs: 100, maxAttempts: 7 });
    const entries = await queue.list();
    expect(entries[0]?.priority).toBe(5);
    expect(entries[0]?.delayMs).toBe(100);
    expect(entries[0]?.availableAt).toBeGreaterThan(entries[0]?.enqueuedAt ?? 0);
    expect(entries[0]?.maxAttempts).toBe(7);
  });

  it('pumps queued entries through the handler', async () => {
    const queue = new InMemoryQueueStore<{ executionId: string }>();
    const handled: string[] = [];
    const worker = new ExecutionWorker({
      queue,
      handler: async (payload) => {
        handled.push(payload.executionId);
      },
    });
    await worker.enqueue({ executionId: 'e1' });
    await worker.enqueue({ executionId: 'e2' });
    worker.start();
    try {
      await worker.waitForIdle();
    } finally {
      await worker.stop();
    }
    expect(handled.sort()).toEqual(['e1', 'e2']);
    expect(worker.isRunning()).toBe(false);
  });

  it('exposes the backing queue store', () => {
    const queue = new InMemoryQueueStore<{ executionId: string }>();
    const worker = new ExecutionWorker({ queue, handler: async () => {} });
    expect(worker.queueStore).toBe(queue);
  });

  it('stop is safe before start', async () => {
    const queue = new InMemoryQueueStore<{ executionId: string }>();
    const worker = new ExecutionWorker({ queue, handler: async () => {} });
    await expect(worker.stop()).resolves.toBeUndefined();
  });

  it('handles handler failures by retrying per the retry policy', async () => {
    const queue = new InMemoryQueueStore<{ executionId: string }>();
    const attempt = vi.fn();
    const worker = new ExecutionWorker({
      queue,
      handler: async (payload, entry) => {
        attempt();
        if (entry.attempts === 0) throw new Error('boom');
        void payload;
      },
    });
    await worker.enqueue({ executionId: 'e1' }, { maxAttempts: 3 });
    worker.start();
    try {
      await worker.waitForIdle();
    } finally {
      await worker.stop();
    }
    expect(attempt).toHaveBeenCalledTimes(2);
    const entries = await queue.list();
    expect(entries[0]?.status).toBe('SUCCEEDED');
  });
});

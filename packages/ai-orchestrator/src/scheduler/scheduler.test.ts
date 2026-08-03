import { describe, expect, it, vi } from 'vitest';
import { Scheduler } from './scheduler.js';

describe('Scheduler', () => {
  it('runs work in priority order with stable sequencing', async () => {
    const scheduler = new Scheduler({ maxConcurrency: 1 });
    const order: string[] = [];
    await Promise.all([
      scheduler.enqueue(async () => { order.push('low'); return 'low'; }, { priority: 5 }),
      scheduler.enqueue(async () => { order.push('high'); return 'high'; }, { priority: 1 }),
      scheduler.enqueue(async () => { order.push('mid'); return 'mid'; }, { priority: 3 }),
    ]);
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('limits concurrency to maxConcurrency', async () => {
    let active = 0;
    let peak = 0;
    const scheduler = new Scheduler({ maxConcurrency: 2 });
    const work = async (): Promise<void> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
    };
    await Promise.all(Array.from({ length: 6 }, () => scheduler.enqueue(work)));
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('rejects cancelled work with the abort reason', async () => {
    const scheduler = new Scheduler({ maxConcurrency: 1 });
    const controller = new AbortController();
    controller.abort();
    await expect(scheduler.enqueue(async () => 'never', { signal: controller.signal })).rejects.toThrow(
      'scheduled work was cancelled',
    );
  });

  it('propagates work errors to the caller', async () => {
    const scheduler = new Scheduler({ maxConcurrency: 1 });
    await expect(scheduler.enqueue(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('reports pending and active counts and resolves idle()', async () => {
    const scheduler = new Scheduler({ maxConcurrency: 1 });
    const gate = new Promise<void>((resolve) => setTimeout(resolve, 5));
    const work = async (): Promise<void> => { await gate; };
    const enqueued = scheduler.enqueue(work);
    expect(scheduler.active).toBe(1);
    const idlePromise = scheduler.idle();
    await enqueued;
    await idlePromise;
    expect(scheduler.pending).toBe(0);
    expect(scheduler.active).toBe(0);
  });

  it('idle() resolves immediately when nothing is queued', async () => {
    const scheduler = new Scheduler({ maxConcurrency: 1 });
    await expect(scheduler.idle()).resolves.toBeUndefined();
  });

  it('spaces work through the rate limiter', async () => {
    const sleep = vi.fn(async () => undefined);
    const scheduler = new Scheduler({ maxConcurrency: 1, maxPerSecond: 2, sleep });
    await scheduler.enqueue(async () => undefined);
    await scheduler.enqueue(async () => undefined);
    expect(sleep).toHaveBeenCalled();
  });

  it('defaults concurrency and accepts work without options', async () => {
    const scheduler = new Scheduler();
    await expect(scheduler.enqueue(async () => 'ok')).resolves.toBe('ok');
    expect(scheduler.pending).toBe(0);
  });
});

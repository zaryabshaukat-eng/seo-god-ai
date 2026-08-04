import type { QueueEntry, QueueStore, RetryPolicy } from '../types/queue.js';
import { realSleep, type SleepFn } from '../utils/time.js';
import { buildRetryPolicy } from './retry-policy.js';
import { WorkerLoop } from './worker-loop.js';

export interface WorkerPoolOptions {
  concurrency: number;
  retryPolicy?: RetryPolicy;
  sleepFn?: SleepFn;
  nowMs?: () => number;
}

/**
 * A pool of workers draining a shared queue with a concurrency cap. `start()`
 * runs workers in the background; `pump()`/`waitForIdle()` process
 * deterministically against an already-started pool. `stop()` is idempotent,
 * terminates every loop and waits for the background drain to settle.
 */
export class WorkerPool<T> {
  private readonly loops: WorkerLoop<T>[] = [];
  private readonly store: QueueStore<T>;
  private readonly sleepFn: SleepFn;
  private running = false;
  private backgroundTask: Promise<void> | null = null;

  constructor(
    store: QueueStore<T>,
    worker: (payload: T, entry: QueueEntry<T>) => Promise<void>,
    options: WorkerPoolOptions,
  ) {
    this.store = store;
    this.sleepFn = options.sleepFn ?? realSleep;
    const retryPolicy = options.retryPolicy ?? buildRetryPolicy();
    for (let i = 0; i < options.concurrency; i += 1) {
      this.loops.push(
        new WorkerLoop({
          store,
          worker,
          retryPolicy,
          sleepFn: this.sleepFn,
          nowMs: options.nowMs,
        }),
      );
    }
  }

  /** Arms the loops and starts the background drain. Safe to call repeatedly. */
  start(): void {
    if (this.running) return;
    this.running = true;
    for (const loop of this.loops) {
      loop.start();
    }
    this.backgroundTask = this.run();
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Stops the background drain and every loop, then waits for any in-flight
   * drain iteration to finish. Idempotent.
   */
  async stop(): Promise<void> {
    if (!this.running && this.backgroundTask === null) return;
    this.running = false;
    for (const loop of this.loops) {
      loop.stop();
    }
    const task = this.backgroundTask;
    this.backgroundTask = null;
    if (task !== null) await task;
  }

  /** Runs every loop once. Returns true when at least one entry was processed. */
  async pump(): Promise<boolean> {
    if (!this.running) return false;
    let worked = false;
    for (const loop of this.loops) {
      if (await loop.runOnce()) worked = true;
    }
    return worked;
  }

  /**
   * Blocks until the queue has no queued or claimed entries left. The pool must
   * be started first; an unstarted pool would never drain, so this throws.
   */
  async waitForIdle(): Promise<void> {
    if (!this.running) {
      throw new Error('WorkerPool.waitForIdle() requires a started pool; call start() first');
    }
    while (await this.hasActiveWork()) {
      const worked = await this.pump();
      if (!worked) await this.sleepFn(10);
    }
  }

  private async hasActiveWork(): Promise<boolean> {
    const entries = await this.store.list();
    return entries.some(
      (entry) => entry.status === 'QUEUED' || entry.status === 'CLAIMED',
    );
  }

  private async run(): Promise<void> {
    try {
      while (this.running) {
        await this.pump();
        await this.sleepFn(10);
      }
    } finally {
      for (const loop of this.loops) {
        loop.stop();
      }
    }
  }
}

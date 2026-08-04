import type { QueueEntry, QueueStore, RetryPolicy } from '../types/queue.js';
import { realSleep, type SleepFn } from '../utils/time.js';

export interface WorkerLoopOptions<T> {
  store: QueueStore<T>;
  worker: (payload: T, entry: QueueEntry<T>) => Promise<void>;
  retryPolicy: RetryPolicy;
  sleepFn?: SleepFn;
  nowMs?: () => number;
}

/**
 * A single worker: claims one entry, runs the worker function, and routes the
 * outcome to success, retry-with-backoff or the dead-letter queue. Failures
 * are retried until the retry policy is exhausted.
 */
export class WorkerLoop<T> {
  private readonly store: QueueStore<T>;
  private readonly worker: (payload: T, entry: QueueEntry<T>) => Promise<void>;
  private readonly retryPolicy: RetryPolicy;
  private readonly sleepFn: SleepFn;
  private readonly nowMs: () => number;
  private running = false;

  constructor(options: WorkerLoopOptions<T>) {
    this.store = options.store;
    this.worker = options.worker;
    this.retryPolicy = options.retryPolicy;
    this.sleepFn = options.sleepFn ?? realSleep;
    this.nowMs = options.nowMs ?? Date.now;
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Claims and processes a single entry. Returns false when nothing ran. */
  async runOnce(): Promise<boolean> {
    if (!this.running) return false;
    const entry = await this.store.claim(this.nowMs());
    if (entry === null) return false;
    try {
      await this.worker(entry.payload, entry);
    } catch (error) {
      await this.handleFailure(entry, error);
      return true;
    }
    await this.handleSuccess(entry);
    return true;
  }

  private async handleSuccess(entry: QueueEntry<T>): Promise<void> {
    if (this.store.wasCancelled(entry.id)) {
      await this.store.cancel(entry.id);
    } else {
      await this.store.complete(entry.id);
    }
  }

  private async handleFailure(entry: QueueEntry<T>, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const nextAttempt = entry.attempts + 1;
    if (this.retryPolicy.isExhausted(nextAttempt)) {
      await this.store.dead(entry.id, message);
      return;
    }
    const delay = this.retryPolicy.delayFor(nextAttempt);
    await this.store.fail(entry.id, message, this.nowMs() + delay);
    if (delay > 0) await this.sleepFn(delay);
  }
}

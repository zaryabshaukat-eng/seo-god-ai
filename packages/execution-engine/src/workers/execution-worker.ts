import type { QueueEntry, QueueStore, RetryPolicy } from '../types/queue.js';
import type { SleepFn } from '../utils/time.js';
import { newId } from '../utils/ids.js';
import { buildRetryPolicy } from '../queue/retry-policy.js';
import { WorkerPool } from '../queue/worker-pool.js';

export interface ExecutionQueuePayload {
  executionId: string;
}

export type QueueJobHandler<T> = (payload: T, entry: QueueEntry<T>) => Promise<void>;

export interface ExecutionWorkerOptions {
  queue: QueueStore<ExecutionQueuePayload>;
  handler: QueueJobHandler<ExecutionQueuePayload>;
  concurrency?: number;
  retryPolicy?: RetryPolicy;
  sleepFn?: SleepFn;
}

/** Drains an execution queue through a bounded worker pool. */
export class ExecutionWorker {
  private readonly pool: WorkerPool<ExecutionQueuePayload>;
  private readonly queue: QueueStore<ExecutionQueuePayload>;

  constructor(options: ExecutionWorkerOptions) {
    this.queue = options.queue;
    this.pool = new WorkerPool<ExecutionQueuePayload>(
      options.queue,
      (payload, entry) => options.handler(payload, entry),
      {
        concurrency: options.concurrency ?? 4,
        retryPolicy: options.retryPolicy ?? buildRetryPolicy(),
        sleepFn: options.sleepFn,
      },
    );
  }

  get queueStore(): QueueStore<ExecutionQueuePayload> {
    return this.queue;
  }

  enqueue(payload: ExecutionQueuePayload, options?: { priority?: number; delayMs?: number; maxAttempts?: number }): Promise<string> {
    const nowMs = Date.now();
    const delayMs = options?.delayMs ?? 0;
    const entry: QueueEntry<ExecutionQueuePayload> = {
      id: newId(),
      payload,
      priority: options?.priority ?? 0,
      delayMs,
      availableAt: nowMs + delayMs,
      enqueuedAt: nowMs,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      status: 'QUEUED',
      lastError: null,
      nextAttemptAt: nowMs + delayMs,
      createdAt: new Date(nowMs),
    };
    void this.queue.enqueue(entry);
    return Promise.resolve(entry.id);
  }

  start(): void {
    this.pool.start();
  }

  async stop(): Promise<void> {
    await this.pool.stop();
  }

  isRunning(): boolean {
    return this.pool.isRunning();
  }

  /** Processes one entry now; returns true when work was done. */
  async pump(): Promise<boolean> {
    return this.pool.pump();
  }

  /** Blocks until every queued/claimed entry has reached a terminal state. */
  async waitForIdle(): Promise<void> {
    await this.pool.waitForIdle();
  }
}

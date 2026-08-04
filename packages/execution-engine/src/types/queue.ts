/**
 * Queue types. The queue is persistent, priority-ordered, delay-aware and
 * retries with exponential backoff; exhausted entries move to a dead-letter
 * queue where they can be inspected, requeued or purged.
 */

export type QueueEntryStatus =
  | 'QUEUED'
  | 'CLAIMED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'DEAD';

export interface QueueEntry<T> {
  id: string;
  payload: T;
  /** Lower values run first. */
  priority: number;
  /** Milliseconds to wait before the entry becomes claimable. */
  delayMs: number;
  /** Epoch ms the entry becomes claimable. */
  availableAt: number;
  enqueuedAt: number;
  attempts: number;
  maxAttempts: number;
  status: QueueEntryStatus;
  lastError: string | null;
  nextAttemptAt: number;
  createdAt: Date;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  /** Computes the delay in ms before attempt `attemptNumber` (1-based). */
  delayFor(attemptNumber: number): number;
  /** True when `attemptNumber` exceeds the configured maximum. */
  isExhausted(attemptNumber: number): boolean;
}

export interface EnqueueOptions {
  priority?: number;
  delayMs?: number;
  maxAttempts?: number;
}

/**
 * Storage contract for the queue. Implementations may be in-memory (default)
 * or persistent (e.g. backed by the database) as long as claim semantics hold.
 */
export interface QueueStore<T> {
  enqueue(entry: QueueEntry<T>): Promise<void>;
  /** Atomically claims the highest-priority available entry, or null. */
  claim(nowMs: number): Promise<QueueEntry<T> | null>;
  /** Marks a claimed entry as succeeded and removes it from active work. */
  complete(id: string): Promise<boolean>;
  /** Records a failed attempt and reschedules with backoff, or dead-letters. */
  fail(id: string, error: string, nextAttemptAt: number): Promise<void>;
  /** Moves an entry to the dead-letter queue. */
  dead(id: string, error: string): Promise<void>;
  /** Cancels a pending entry. Returns false if it was not cancellable. */
  cancel(id: string): Promise<boolean>;
  /** Cancels all pending entries matching a predicate. Returns the count. */
  cancelAll(predicate?: (entry: QueueEntry<T>) => boolean): Promise<number>;
  list(status?: QueueEntryStatus): Promise<QueueEntry<T>[]>;
  requeueDead(id: string, priority?: number): Promise<boolean>;
  purge(): Promise<number>;
  /** True when a claimed entry was cancelled while it was in flight. */
  wasCancelled(id: string): boolean;
  size(): number;
}

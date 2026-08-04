import type { EnqueueOptions, QueueEntry, QueueEntryStatus, QueueStore } from '../types/queue.js';
import { newId } from '../utils/ids.js';
import { availableAt } from '../utils/time.js';

export interface QueueStoreOptions {
  nowMs?: () => number;
}

/**
 * Priority-ordered, delay-aware, retry-capable queue with a dead-letter sink.
 * Entries are claimed atomically by priority (then FIFO); cancelled in-flight
 * entries are tracked so workers can drop them after the fact.
 */
export class InMemoryQueueStore<T> implements QueueStore<T> {
  private readonly entries = new Map<string, QueueEntry<T>>();
  private readonly cancelledInFlight = new Set<string>();
  private readonly nowMs: () => number;

  constructor(options: QueueStoreOptions = {}) {
    this.nowMs = options.nowMs ?? Date.now;
  }

  async enqueue(entry: QueueEntry<T>): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  /** Convenience enqueue that builds a well-formed entry. */
  async enqueuePayload(payload: T, options: EnqueueOptions = {}): Promise<QueueEntry<T>> {
    const now = this.nowMs();
    const delayMs = options.delayMs ?? 0;
    const entry: QueueEntry<T> = {
      id: newId(),
      payload,
      priority: options.priority ?? 0,
      delayMs,
      availableAt: availableAt(delayMs, now),
      enqueuedAt: now,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      status: 'QUEUED',
      lastError: null,
      nextAttemptAt: now,
      createdAt: new Date(now),
    };
    await this.enqueue(entry);
    return entry;
  }

  async claim(nowMs: number): Promise<QueueEntry<T> | null> {
    let best: QueueEntry<T> | null = null;
    for (const entry of this.entries.values()) {
      if (entry.status !== 'QUEUED') continue;
      if (entry.availableAt > nowMs) continue;
      if (
        best === null ||
        entry.priority < best.priority ||
        (entry.priority === best.priority && entry.enqueuedAt < best.enqueuedAt)
      ) {
        best = entry;
      }
    }
    if (best === null) return null;
    best.status = 'CLAIMED';
    return best;
  }

  async complete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (entry === undefined) return false;
    this.cancelledInFlight.delete(id);
    if (entry.status === 'CANCELLED') return false;
    entry.status = 'SUCCEEDED';
    return true;
  }

  async fail(id: string, error: string, nextAttemptAt: number): Promise<void> {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    entry.lastError = error;
    entry.attempts += 1;
    if (entry.attempts >= entry.maxAttempts) {
      entry.status = 'DEAD';
      return;
    }
    entry.status = 'QUEUED';
    entry.nextAttemptAt = nextAttemptAt;
    entry.availableAt = nextAttemptAt;
  }

  async dead(id: string, error: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    entry.lastError = error;
    entry.status = 'DEAD';
    this.cancelledInFlight.delete(id);
  }

  async cancel(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (entry === undefined) return false;
    if (entry.status === 'CLAIMED') {
      this.cancelledInFlight.add(id);
      return true;
    }
    if (entry.status !== 'QUEUED') return false;
    entry.status = 'CANCELLED';
    this.cancelledInFlight.delete(id);
    return true;
  }

  async cancelAll(predicate?: (entry: QueueEntry<T>) => boolean): Promise<number> {
    let count = 0;
    for (const entry of [...this.entries.values()]) {
      if (entry.status === 'QUEUED' || entry.status === 'CLAIMED') {
        if (predicate !== undefined && !predicate(entry)) continue;
        if (await this.cancel(entry.id)) count += 1;
      }
    }
    return count;
  }

  async list(status?: QueueEntryStatus): Promise<QueueEntry<T>[]> {
    const all = [...this.entries.values()];
    return status === undefined ? all : all.filter((entry) => entry.status === status);
  }

  async requeueDead(id: string, priority?: number): Promise<boolean> {
    const entry = this.entries.get(id);
    if (entry === undefined || entry.status !== 'DEAD') return false;
    const now = this.nowMs();
    entry.status = 'QUEUED';
    entry.attempts = 0;
    entry.lastError = null;
    entry.priority = priority ?? entry.priority;
    entry.availableAt = now;
    entry.nextAttemptAt = now;
    return true;
  }

  async purge(): Promise<number> {
    const count = this.entries.size;
    this.entries.clear();
    this.cancelledInFlight.clear();
    return count;
  }

  wasCancelled(id: string): boolean {
    return this.cancelledInFlight.has(id);
  }

  size(): number {
    return this.entries.size;
  }
}

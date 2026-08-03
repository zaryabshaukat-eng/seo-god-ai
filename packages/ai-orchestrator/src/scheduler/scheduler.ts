import { RateLimiter } from '../execution/rate-limiter.js';

export interface SchedulerOptions {
  /** Max concurrent work items (default 8). */
  maxConcurrency?: number;
  /** Global rate cap across scheduled work (0 = unlimited). */
  maxPerSecond?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ScheduleOptions {
  /** Lower runs first (default 0). */
  priority?: number;
  signal?: AbortSignal;
}

interface QueueItem<T> {
  run: () => Promise<T>;
  priority: number;
  sequence: number;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
}

/**
 * Priority scheduler with concurrency + rate limiting. Runs work items in
 * priority order, bounded by `maxConcurrency`; the rate limiter spaces
 * starts so bursty workflows stay within provider budgets.
 */
export class Scheduler {
  private readonly queue: QueueItem<unknown>[] = [];
  private readonly maxConcurrency: number;
  private readonly rateLimiter: RateLimiter;
  private running = 0;
  private sequence = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(options: SchedulerOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 8;
    this.rateLimiter = new RateLimiter({
      maxPerSecond: options.maxPerSecond,
      sleep: options.sleep,
      now: options.now,
    });
  }

  enqueue<T>(work: () => Promise<T>, options: ScheduleOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<unknown> = {
        run: work as () => Promise<unknown>,
        priority: options.priority ?? 0,
        sequence: this.sequence,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal: options.signal,
      };
      this.sequence += 1;
      this.insert(item);
      void this.drain();
    });
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.running;
  }

  /** Resolves once the queue is empty and nothing is running. */
  async idle(): Promise<void> {
    if (this.pending === 0 && this.running === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private insert(item: QueueItem<unknown>): void {
    let index = this.queue.length;
    this.queue.push(item);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentItem = this.queue[parent];
      if (parentItem === undefined) break;
      const current = this.queue[index] as QueueItem<unknown>;
      if (this.before(current, parentItem)) {
        this.queue[index] = parentItem;
        this.queue[parent] = current;
        index = parent;
      } else {
        break;
      }
    }
  }

  private before(a: QueueItem<unknown>, b: QueueItem<unknown>): boolean {
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.sequence < b.sequence;
  }

  private pop(): QueueItem<unknown> | undefined {
    const first = this.queue[0];
    if (first === undefined) return undefined;
    const last = this.queue.pop();
    if (last === undefined) return first;
    if (this.queue.length > 0) {
      this.queue[0] = last;
      this.heapify(0);
    }
    return first;
  }

  private heapify(index: number): void {
    const left = index * 2 + 1;
    const right = index * 2 + 2;
    let smallest = index;
    if (left < this.queue.length) {
      const leftItem = this.queue[left];
      const smallestItem = this.queue[smallest];
      if (leftItem !== undefined && smallestItem !== undefined && this.before(leftItem, smallestItem)) {
        smallest = left;
      }
    }
    if (right < this.queue.length) {
      const rightItem = this.queue[right];
      const smallestItem = this.queue[smallest];
      if (rightItem !== undefined && smallestItem !== undefined && this.before(rightItem, smallestItem)) {
        smallest = right;
      }
    }
    if (smallest !== index) {
      const tmp = this.queue[index] as QueueItem<unknown>;
      this.queue[index] = this.queue[smallest] as QueueItem<unknown>;
      this.queue[smallest] = tmp;
      this.heapify(smallest);
    }
  }

  private async drain(): Promise<void> {
    if (this.running >= this.maxConcurrency) return;
    this.running += 1;
    while (this.queue.length > 0) {
      await this.rateLimiter.acquire();
      const item = this.pop();
      if (item === undefined) break;
      if (item.signal?.aborted === true) {
        item.reject(new Error('scheduled work was cancelled'));
        continue;
      }
      try {
        const value = await item.run();
        item.resolve(value);
      } catch (error) {
        item.reject(error);
      }
    }
    this.running -= 1;
    if (this.running === 0 && this.queue.length === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const waiter of waiters) waiter();
    }
  }
}

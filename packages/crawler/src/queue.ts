import type { UrlRecord } from './types.js';

export interface UrlQueueOptions {
  /** Soft cap on URLs held in the queue (not yet visited). */
  maxSize?: number;
  /** Hard cap on total URLs admitted to the crawl. */
  visitedLimit?: number;
}

interface HeapEntry {
  record: UrlRecord;
  order: number;
}

/**
 * Priority queue of URLs to crawl. Enforces deduplication (each normalized
 * URL is visited at most once), breadth-first ordering via the `depth` and
 * `priority` fields on {@link UrlRecord}, and a hard cap on admitted URLs so
 * a runaway store can never spiral out of control.
 */
export class UrlQueue {
  private readonly heap: HeapEntry[] = [];
  private readonly queued = new Set<string>();
  private readonly visited = new Set<string>();
  private readonly maxSize: number;
  private readonly visitedLimit: number;
  private nextOrder = 0;

  constructor(options: UrlQueueOptions = {}) {
    this.maxSize = options.maxSize ?? Number.POSITIVE_INFINITY;
    this.visitedLimit = options.visitedLimit ?? Number.POSITIVE_INFINITY;
  }

  /** Returns true when the URL was newly enqueued, false if rejected. */
  add(record: UrlRecord): boolean {
    const key = record.url;
    if (this.queued.has(key) || this.visited.has(key)) return false;
    if (this.visited.size + this.queued.size >= this.visitedLimit) return false;
    if (this.queued.size >= this.maxSize) return false;

    this.queued.add(key);
    this.push({ record, order: this.nextOrder });
    this.nextOrder += 1;
    return true;
  }

  /** Pops the next URL (lowest priority, then insertion order). */
  next(): UrlRecord | null {
    const entry = this.pop();
    if (entry === null) return null;
    this.queued.delete(entry.record.url);
    this.visited.add(entry.record.url);
    return entry.record;
  }

  /** Whether the queue has URLs waiting to be crawled. */
  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /** Number of URLs still queued. */
  get size(): number {
    return this.heap.length;
  }

  /** Number of URLs that have been popped (visited). */
  get visitedCount(): number {
    return this.visited.size;
  }

  /** Whether a URL has already been visited or is queued. */
  contains(url: string): boolean {
    return this.queued.has(url) || this.visited.has(url);
  }

  private push(entry: HeapEntry): void {
    this.heap.push(entry);
    let index = this.heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const current = this.heap[index];
      const parentEntry = this.heap[parent];
      if (current !== undefined && parentEntry !== undefined && this.less(current, parentEntry)) {
        this.swap(index, parent);
        index = parent;
      } else {
        break;
      }
    }
  }

  private pop(): HeapEntry | null {
    if (this.heap.length === 0) return null;
    const top = this.heap[0] as HeapEntry;
    const last = this.heap.pop();
    if (this.heap.length > 0 && last !== undefined) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftDown(index: number): void {
    while (true) {
      let smallest = index;
      const left = index * 2 + 1;
      const right = left + 1;
      const leftEntry = this.heap[left];
      const rightEntry = this.heap[right];
      const smallestEntry = this.heap[smallest];
      if (
        smallestEntry !== undefined &&
        leftEntry !== undefined &&
        this.less(leftEntry, smallestEntry)
      ) {
        smallest = left;
      }
      const updatedSmallest = this.heap[smallest];
      if (
        updatedSmallest !== undefined &&
        rightEntry !== undefined &&
        this.less(rightEntry, updatedSmallest)
      ) {
        smallest = right;
      }
      if (smallest === index) break;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.heap[a] as HeapEntry;
    this.heap[a] = this.heap[b] as HeapEntry;
    this.heap[b] = tmp;
  }

  private less(a: HeapEntry, b: HeapEntry): boolean {
    if (a.record.priority !== b.record.priority) return a.record.priority < b.record.priority;
    return a.order < b.order;
  }
}

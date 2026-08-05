/**
 * A deterministic binary min-heap priority queue.
 *
 * Ordering is decided by a comparator supplied at construction, so the same
 * heap serves the job queue (priority, then due time, then insertion order)
 * and generic call sites. Items are popped in ascending comparator order and
 * ties are broken by insertion order to keep runs reproducible.
 */

export interface PriorityQueueComparator<T> {
  (a: T, b: T): number;
}

interface Entry<T> {
  value: T;
  sequence: number;
}

/** A binary min-heap queue keyed by an arbitrary comparator. */
export class PriorityQueue<T> {
  private readonly heap: Array<Entry<T>> = [];
  private readonly compare: PriorityQueueComparator<T>;
  private sequence = 0;

  constructor(compare: PriorityQueueComparator<T>) {
    this.compare = compare;
  }

  get size(): number {
    return this.heap.length;
  }

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  push(value: T): void {
    const entry: Entry<T> = { value, sequence: this.sequence };
    this.sequence += 1;
    this.heap.push(entry);
    this.siftUp(this.heap.length - 1);
  }

  /** Returns the highest-priority item without removing it. */
  peek(): T | null {
    const root = this.heap[0];
    return root === undefined ? null : root.value;
  }

  /** Removes and returns the highest-priority item, or `null` when empty. */
  pop(): T | null {
    const root = this.heap[0];
    if (root === undefined) return null;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return root.value;
  }

  /** Removes an item (by reference). Returns `true` when it was removed. */
  remove(value: T): boolean {
    const index = this.heap.findIndex((entry) => entry.value === value);
    if (index === -1) return false;
    this.removeAt(index);
    return true;
  }

  clear(): void {
    this.heap.length = 0;
  }

  /** Returns items sorted in pop order (ascending by comparator). */
  toArray(): T[] {
    const copy = new PriorityQueue<T>(this.compare);
    for (const entry of this.heap) copy.heap.push({ ...entry });
    const sorted: T[] = [];
    while (!copy.isEmpty) {
      const value = copy.pop();
      if (value !== null) sorted.push(value);
    }
    return sorted;
  }

  private removeAt(index: number): void {
    const last = this.heap.pop()!;
    if (index === this.heap.length) return;
    this.heap[index] = last;
    this.siftUp(index);
    this.siftDown(index);
  }

  private siftUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.less(current, parent)) {
        this.swap(current, parent);
        current = parent;
      } else {
        return;
      }
    }
  }

  private siftDown(index: number): void {
    const size = this.heap.length;
    let current = index;
    for (;;) {
      const left = current * 2 + 1;
      const right = left + 1;
      let smallest = current;
      if (left < size && this.less(left, smallest)) smallest = left;
      if (right < size && this.less(right, smallest)) smallest = right;
      if (smallest === current) return;
      this.swap(current, smallest);
      current = smallest;
    }
  }

  private less(a: number, b: number): boolean {
    const left = this.heap[a]!;
    const right = this.heap[b]!;
    const byValue = this.compare(left.value, right.value);
    if (byValue !== 0) return byValue < 0;
    return left.sequence < right.sequence;
  }

  private swap(a: number, b: number): void {
    const tmp = this.heap[a]!;
    this.heap[a] = this.heap[b]!;
    this.heap[b] = tmp;
  }
}

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Builds a comparator that orders by the given keys in priority order. */
export function priorityComparator(order: Record<string, number>): PriorityQueueComparator<string> {
  return (a, b) => (order[a] ?? Number.MAX_SAFE_INTEGER) - (order[b] ?? Number.MAX_SAFE_INTEGER);
}

/** Comparator for scheduler job priorities (critical first). */
export function jobPriorityComparator(): PriorityQueueComparator<string> {
  return priorityComparator(PRIORITY_ORDER);
}

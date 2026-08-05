import { describe, expect, it } from 'vitest';
import {
  jobPriorityComparator,
  PriorityQueue,
  priorityComparator,
} from './priority-queue.js';

const ascending = (a: number, b: number): number => a - b;

describe('PriorityQueue', () => {
  it('pops items in ascending comparator order', () => {
    const queue = new PriorityQueue<number>(ascending);
    queue.push(5);
    queue.push(1);
    queue.push(3);
    expect(queue.pop()).toBe(1);
    expect(queue.pop()).toBe(3);
    expect(queue.pop()).toBe(5);
    expect(queue.pop()).toBeNull();
  });

  it('tracks size and emptiness', () => {
    const queue = new PriorityQueue<number>(ascending);
    expect(queue.isEmpty).toBe(true);
    queue.push(1);
    expect(queue.size).toBe(1);
    expect(queue.isEmpty).toBe(false);
  });

  it('peeks without removing', () => {
    const queue = new PriorityQueue<number>(ascending);
    expect(queue.peek()).toBeNull();
    queue.push(2);
    queue.push(1);
    expect(queue.peek()).toBe(1);
    expect(queue.size).toBe(2);
  });

  it('is stable: equal items pop in insertion order', () => {
    const queue = new PriorityQueue<string>(priorityComparator({ a: 0, b: 0 }));
    queue.push('a');
    queue.push('b');
    queue.push('c');
    expect(queue.toArray()).toEqual(['a', 'b', 'c']);
  });

  it('removes an item by reference', () => {
    const queue = new PriorityQueue<{ id: number }>((x, y) => x.id - y.id);
    const target = { id: 2 };
    queue.push({ id: 1 });
    queue.push(target);
    queue.push({ id: 3 });
    expect(queue.remove(target)).toBe(true);
    expect(queue.remove({ id: 999 })).toBe(false);
    expect(queue.size).toBe(2);
    expect(queue.pop()?.id).toBe(1);
    expect(queue.pop()?.id).toBe(3);
  });

  it('removes the last element cleanly', () => {
    const queue = new PriorityQueue<number>(ascending);
    queue.push(1);
    expect(queue.remove(1)).toBe(true);
    expect(queue.pop()).toBeNull();
  });

  it('clears all items', () => {
    const queue = new PriorityQueue<number>(ascending);
    queue.push(1);
    queue.push(2);
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.pop()).toBeNull();
  });

  it('sorts mixed insertions via toArray', () => {
    const queue = new PriorityQueue<number>(ascending);
    queue.push(9);
    queue.push(1);
    queue.push(5);
    queue.push(2);
    expect(queue.toArray()).toEqual([1, 2, 5, 9]);
  });

  it('sifts down through the right child when it is the minimum', () => {
    const queue = new PriorityQueue<number>(ascending);
    for (const value of [1, 3, 2, 4, 5]) queue.push(value);
    expect(queue.pop()).toBe(1);
    expect(queue.toArray()).toEqual([2, 3, 4, 5]);
  });

  it('handles heap repairs on removal from the middle', () => {
    const queue = new PriorityQueue<number>(ascending);
    queue.push(10);
    queue.push(9);
    queue.push(8);
    queue.push(7);
    queue.push(6);
    expect(queue.remove(9)).toBe(true);
    expect(queue.toArray()).toEqual([6, 7, 8, 10]);
  });

  it('treats unknown comparator keys as lowest priority', () => {
    const queue = new PriorityQueue<string>(jobPriorityComparator());
    queue.push('unknown');
    queue.push('critical');
    expect(queue.toArray()).toEqual(['critical', 'unknown']);
  });
});

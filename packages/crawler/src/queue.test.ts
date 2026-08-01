import { describe, expect, it } from 'vitest';
import { UrlQueue } from './queue.js';
import { makeUrlRecord } from './utils/urls.js';

describe('UrlQueue', () => {
  it('pops URLs in priority order', () => {
    const queue = new UrlQueue();
    queue.add(makeUrlRecord('https://acme.myshopify.com/pages/about', 1)!);
    queue.add(makeUrlRecord('https://acme.myshopify.com/', 0, true)!);
    queue.add(makeUrlRecord('https://acme.myshopify.com/products/hat', 3)!);

    expect(queue.next()?.url).toBe('https://acme.myshopify.com/');
    expect(queue.next()?.url).toBe('https://acme.myshopify.com/pages/about');
    expect(queue.next()?.url).toBe('https://acme.myshopify.com/products/hat');
    expect(queue.next()).toBeNull();
  });

  it('tracks visited URLs and rejects duplicates', () => {
    const queue = new UrlQueue();
    const record = makeUrlRecord('https://acme.myshopify.com/products/hat')!;
    expect(queue.add(record)).toBe(true);
    expect(queue.add({ ...record })).toBe(false);
    expect(queue.contains(record.url)).toBe(true);

    queue.next();
    expect(queue.contains(record.url)).toBe(true);
    expect(queue.add(record)).toBe(false);
    expect(queue.contains('https://acme.myshopify.com/missing')).toBe(false);
    expect(queue.visitedCount).toBe(1);
    expect(queue.isEmpty).toBe(true);
    expect(queue.size).toBe(0);
  });

  it('enforces the queued-size cap', () => {
    const queue = new UrlQueue({ maxSize: 1 });
    expect(queue.add(makeUrlRecord('https://acme.myshopify.com/a')!)).toBe(true);
    expect(queue.add(makeUrlRecord('https://acme.myshopify.com/b')!)).toBe(false);
  });

  it('enforces the visited limit', () => {
    const queue = new UrlQueue({ visitedLimit: 2 });
    expect(queue.add(makeUrlRecord('https://acme.myshopify.com/a')!)).toBe(true);
    expect(queue.add(makeUrlRecord('https://acme.myshopify.com/b')!)).toBe(true);
    expect(queue.add(makeUrlRecord('https://acme.myshopify.com/c')!)).toBe(false);
    expect(queue.next()).not.toBeNull();
    expect(queue.add(makeUrlRecord('https://acme.myshopify.com/d')!)).toBe(false);
  });

  it('interleaves many URLs and drains in priority order', () => {
    const queue = new UrlQueue();
    for (let i = 20; i >= 0; i -= 1) {
      queue.add(makeUrlRecord(`https://acme.myshopify.com/products/${i}`, i)!);
    }
    const popped: number[] = [];
    while (!queue.isEmpty) {
      popped.push(Number(queue.next()?.url.split('/').pop()));
    }
    expect(popped).toEqual([...popped].sort((a, b) => a - b));
    expect(popped).toHaveLength(21);
  });
});

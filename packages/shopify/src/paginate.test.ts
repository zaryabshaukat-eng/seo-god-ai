import { describe, expect, it } from 'vitest';
import { paginate } from './paginate.js';
import type { PageInfo } from './types.js';

const page = (hasNextPage: boolean, endCursor: string | null): PageInfo => ({
  hasNextPage,
  endCursor,
});

describe('paginate', () => {
  it('collects items across multiple pages', async () => {
    const pages = [
      { items: [1, 2], pageInfo: page(true, 'cursor-a') },
      { items: [3, 4], pageInfo: page(true, 'cursor-b') },
      { items: [5], pageInfo: page(false, null) },
    ];
    let index = 0;
    const seenCursors: Array<string | null> = [];

    const result = await paginate({
      fetchPage: async (after) => {
        seenCursors.push(after);
        return pages[index++]!;
      },
    });

    expect(seenCursors).toEqual([null, 'cursor-a', 'cursor-b']);
    expect(result.items).toEqual([1, 2, 3, 4, 5]);
    expect(result.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
  });

  it('stops at the maxPages cap', async () => {
    let calls = 0;
    const result = await paginate(
      {
        fetchPage: async () => {
          calls += 1;
          return { items: [calls], pageInfo: page(true, `cursor-${calls}`) };
        },
      },
      { maxPages: 3 },
    );

    expect(calls).toBe(3);
    expect(result.items).toEqual([1, 2, 3]);
  });

  it('stops when the end cursor repeats (infinite-loop guard)', async () => {
    let calls = 0;
    const result = await paginate({
      fetchPage: async () => {
        calls += 1;
        return { items: ['x'], pageInfo: page(true, 'stuck-cursor') };
      },
    });

    // One call discovers the cursor, a second call reveals it repeats, then it stops.
    expect(calls).toBe(2);
    expect(result.items).toEqual(['x', 'x']);
  });
});

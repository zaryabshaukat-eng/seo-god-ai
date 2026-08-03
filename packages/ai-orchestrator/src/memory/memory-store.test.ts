import { describe, expect, it } from 'vitest';
import { InMemoryMemoryStore } from './memory-store.js';
import type { MemoryEntry } from '../types/memory.js';

function entry(overrides: Partial<MemoryEntry> = {}): Omit<MemoryEntry, 'id' | 'createdAt'> {
  return {
    storeId: 'store-1',
    kind: 'agent-output',
    key: 'agent:title-writer',
    data: { ok: true },
    ...overrides,
  };
}

describe('InMemoryMemoryStore', () => {
  it('adds entries with ids and timestamps', async () => {
    const store = new InMemoryMemoryStore(() => 'id-1');
    const now = new Date('2026-01-01T00:00:00Z');
    const record = await store.add(entry(), () => now);
    expect(record.id).toBe('id-1');
    expect(record.createdAt).toBe(now);
  });

  it('queries by store, agent, kind, and key', async () => {
    const store = new InMemoryMemoryStore();
    await store.add(entry({ storeId: 'store-1', agentId: 'a', kind: 'execution', key: 'k1' }));
    await store.add(entry({ storeId: 'store-1', agentId: 'b', kind: 'execution', key: 'k1' }));
    await store.add(entry({ storeId: 'store-2', agentId: 'a', kind: 'execution', key: 'k1' }));

    const results = await store.query({ storeId: 'store-1', agentId: 'a', key: 'k1' });
    expect(results).toHaveLength(1);
    expect(await store.query({ storeId: 'store-1', kind: 'validation' })).toHaveLength(0);
  });

  it('sorts newest first and applies limit and before filters', async () => {
    const store = new InMemoryMemoryStore();
    await store.add(entry({ kind: 'execution' }), () => new Date('2026-01-01T00:00:01Z'));
    await store.add(entry({ kind: 'execution' }), () => new Date('2026-01-01T00:00:02Z'));
    await store.add(entry({ kind: 'execution' }), () => new Date('2026-01-01T00:00:03Z'));

    const all = await store.query({});
    expect(all.map((e) => e.createdAt.getTime())).toEqual([3, 2, 1].map((n) => new Date(`2026-01-01T00:00:0${n}Z`).getTime()));

    const limited = await store.query({ limit: 1 });
    expect(limited).toHaveLength(1);

    const before = await store.query({ before: new Date('2026-01-01T00:00:03Z') });
    expect(before).toHaveLength(2);
  });

  it('returns the latest matching entry or null', async () => {
    const store = new InMemoryMemoryStore();
    expect(await store.latest('store-1', 'execution', 'k1')).toBeNull();
    await store.add(entry({ kind: 'execution', key: 'k1' }), () => new Date('2026-01-01T00:00:01Z'));
    const second = await store.add(entry({ kind: 'execution', key: 'k1' }), () => new Date('2026-01-01T00:00:02Z'));
    expect(await store.latest('store-1', 'execution', 'k1')).toEqual(second);
  });

  it('does not slice when limit is 0 or negative', async () => {
    const store = new InMemoryMemoryStore();
    await store.add(entry({}));
    await store.add(entry({}));
    expect(await store.query({ limit: 0 })).toHaveLength(2);
  });
});

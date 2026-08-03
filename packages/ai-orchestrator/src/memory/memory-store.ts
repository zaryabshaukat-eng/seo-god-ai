import type { MemoryEntry, MemoryKind, MemoryQuery } from '../types/memory.js';

/** Persists conversation, execution, tool-output, agent-output, validation. */
export interface MemoryStore {
  add(entry: Omit<MemoryEntry, 'id' | 'createdAt'>, now?: () => Date): Promise<MemoryEntry>;
  query(query: MemoryQuery): Promise<MemoryEntry[]>;
  latest(storeId: string, kind: MemoryKind, key: string): Promise<MemoryEntry | null>;
}

/** In-memory memory store, ordered newest-first, with stable filtering. */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly entries: MemoryEntry[] = [];
  private readonly newId: () => string;

  constructor(idFactory: () => string = () => Math.random().toString(36).slice(2)) {
    this.newId = idFactory;
  }

  async add(
    entry: Omit<MemoryEntry, 'id' | 'createdAt'>,
    now: () => Date = () => new Date(),
  ): Promise<MemoryEntry> {
    const record: MemoryEntry = {
      ...entry,
      id: this.newId(),
      createdAt: now(),
    };
    this.entries.push(record);
    return record;
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    let results = this.entries;
    if (query.storeId !== undefined) results = results.filter((e) => e.storeId === query.storeId);
    if (query.agentId !== undefined) results = results.filter((e) => e.agentId === query.agentId);
    if (query.kind !== undefined) results = results.filter((e) => e.kind === query.kind);
    if (query.key !== undefined) results = results.filter((e) => e.key === query.key);
    if (query.before !== undefined) {
      results = results.filter((e) => e.createdAt < (query.before as Date));
    }
    results = [...results].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    if (query.limit !== undefined && query.limit > 0) {
      results = results.slice(0, query.limit);
    }
    return results;
  }

  async latest(storeId: string, kind: MemoryKind, key: string): Promise<MemoryEntry | null> {
    const matches = await this.query({ storeId, kind, key, limit: 1 });
    return matches[0] ?? null;
  }
}

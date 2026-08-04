import { describe, expect, it } from 'vitest';
import { MemoryEntryModel } from './memory-entry.js';

describe('MemoryEntryModel', () => {
  it('builds an entry with id and injected clock', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const entry = MemoryEntryModel.build(
      {
        storeId: 'store-1',
        agentId: 'metadata',
        kind: 'agent_history',
        key: 'history:task-1',
        data: { taskId: 'task-1' },
      },
      () => now,
    );
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.createdAt).toBe(now);
    expect(entry.data).toEqual({ taskId: 'task-1' });
  });

  it('uses the default clock when not provided', () => {
    const entry = MemoryEntryModel.build({
      storeId: 'store-1',
      agentId: 'metadata',
      kind: 'execution',
      key: 'execution:run-1',
      data: {},
    });
    expect(entry.createdAt).toBeInstanceOf(Date);
  });
});

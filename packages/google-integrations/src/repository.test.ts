import { describe, expect, it } from 'vitest';
import { MemoryGoogleSyncRepository, type SyncState } from './repository.js';

function state(overrides: Partial<SyncState> = {}): SyncState {
  return {
    provider: 'search-console',
    resource: 'sc-domain:example.com',
    cursor: '2026-08-01',
    lastSyncedAt: '2026-08-01T00:00:00Z',
    status: 'SYNCED',
    ...overrides,
  };
}

describe('MemoryGoogleSyncRepository', () => {
  it('saves, returns copies and reads states', async () => {
    const repo = new MemoryGoogleSyncRepository();
    const saved = state();
    await repo.saveState(saved);
    saved.cursor = 'mutated';

    const read = await repo.getState('search-console', 'sc-domain:example.com');
    expect(read?.cursor).toBe('2026-08-01');
    expect(read?.status).toBe('SYNCED');
  });

  it('returns null for unknown keys and supports delete', async () => {
    const repo = new MemoryGoogleSyncRepository();
    expect(await repo.getState('analytics', '12345')).toBeNull();

    await repo.saveState(state());
    await repo.deleteState('search-console', 'sc-domain:example.com');
    expect(await repo.getState('search-console', 'sc-domain:example.com')).toBeNull();
  });

  it('lists states, optionally filtered by provider', async () => {
    const repo = new MemoryGoogleSyncRepository();
    await repo.saveState(state());
    await repo.saveState(state({ provider: 'analytics', resource: '12345' }));
    await repo.saveState(state({ provider: 'search-console', resource: 'sc-domain:other.com', status: 'FAILED', error: 'boom' }));

    expect((await repo.listStates()).length).toBe(3);
    const searchConsole = await repo.listStates('search-console');
    expect(searchConsole.length).toBe(2);
    expect(searchConsole.every((s) => s.provider === 'search-console')).toBe(true);
    expect(searchConsole.some((s) => s.status === 'FAILED' && s.error === 'boom')).toBe(true);
  });

  it('treats the resource case-sensitively for lookups', async () => {
    const repo = new MemoryGoogleSyncRepository();
    await repo.saveState(state());
    expect(await repo.getState('search-console', 'SC-DOMAIN:EXAMPLE.COM')).toBeNull();
  });
});

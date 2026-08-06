import { describe, expect, it } from 'vitest';
import { CopilotNotFoundError, CopilotValidationError } from './errors.js';
import { InMemoryConversationStore } from './memory.js';
import type { CopilotSession } from './types.js';

function session(overrides: Partial<CopilotSession> = {}): CopilotSession {
  return {
    sessionId: 'conv_1',
    tenantId: 'tenant_a',
    storeId: 'store_1',
    userId: 'user_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [{ role: 'system', content: 'sys' }],
    ...overrides,
  };
}

describe('InMemoryConversationStore', () => {
  it('saves and reads sessions', async () => {
    const store = new InMemoryConversationStore();
    await store.saveSession(session());
    const read = await store.getSession('conv_1');
    expect(read).not.toBeNull();
    expect(read?.tenantId).toBe('tenant_a');
  });

  it('returns null for unknown sessions', async () => {
    const store = new InMemoryConversationStore();
    expect(await store.getSession('conv_missing')).toBeNull();
  });

  it('lists sessions scoped to a tenant and sorted newest first', async () => {
    const store = new InMemoryConversationStore();
    await store.saveSession(session({ sessionId: 'c1', updatedAt: '2026-01-03T00:00:00.000Z' }));
    await store.saveSession(session({ sessionId: 'c2', updatedAt: '2026-01-05T00:00:00.000Z' }));
    await store.saveSession(session({ sessionId: 'c3', tenantId: 'tenant_b', updatedAt: '2026-01-06T00:00:00.000Z' }));

    const list = await store.listSessions({ tenantId: 'tenant_a' });
    expect(list.map((s) => s.sessionId)).toEqual(['c2', 'c1']);
  });

  it('filters by store, user and limit', async () => {
    const store = new InMemoryConversationStore();
    await store.saveSession(session({ sessionId: 'c1', storeId: 's1', userId: 'u1' }));
    await store.saveSession(session({ sessionId: 'c2', storeId: 's2', userId: 'u1' }));
    await store.saveSession(session({ sessionId: 'c3', storeId: 's1', userId: 'u2' }));

    expect(await store.listSessions({ tenantId: 'tenant_a', storeId: 's1', userId: 'u1' })).toHaveLength(1);
    expect(await store.listSessions({ tenantId: 'tenant_a', limit: 1 })).toHaveLength(1);
  });

  it('deletes sessions', async () => {
    const store = new InMemoryConversationStore();
    await store.saveSession(session());
    await store.deleteSession('conv_1', 'tenant_a');
    expect(await store.getSession('conv_1')).toBeNull();
  });

  it('rejects deleting unknown sessions', async () => {
    const store = new InMemoryConversationStore();
    await expect(store.deleteSession('conv_x', 'tenant_a')).rejects.toThrow(CopilotNotFoundError);
  });

  it('rejects cross-tenant deletion', async () => {
    const store = new InMemoryConversationStore();
    await store.saveSession(session());
    await expect(store.deleteSession('conv_1', 'tenant_b')).rejects.toThrow(CopilotValidationError);
  });
});

import { describe, expect, it } from 'vitest';
import { createApiFunctions } from './api-helpers.js';

describe('createApiFunctions', () => {
  it('maps verbs and path params onto request', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const api = {
      request: async <T>(method: string, url: string, body: unknown): Promise<T> => {
        calls.push({ method, url, body });
        return { ok: true } as T;
      },
    } as never;
    const call = createApiFunctions(api);
    await call.get('crawlsList');
    await call.get('crawlsGet', { id: 'c1' });
    await call.post('crawlsStart', { storeId: 's1' });
    await call.put('settingsUpdate', { theme: 'dark' });
    await call.patch('membersUpdateRole', { role: 'admin' }, { id: 'm1' });
    await call.del('apiKeysRevoke', { id: 'k1' });
    expect(calls).toEqual([
      { method: 'GET', url: '/api/v1/crawls', body: undefined },
      { method: 'GET', url: '/api/v1/crawls/c1', body: undefined },
      { method: 'POST', url: '/api/v1/crawls', body: { storeId: 's1' } },
      { method: 'PUT', url: '/api/v1/settings', body: { theme: 'dark' } },
      { method: 'PATCH', url: '/api/v1/admin/members/m1/role', body: { role: 'admin' } },
      { method: 'DELETE', url: '/api/v1/admin/api-keys/k1', body: undefined },
    ]);
  });
});

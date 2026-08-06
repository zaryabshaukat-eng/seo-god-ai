import { describe, expect, it, vi } from 'vitest';
import {
  createAuthApi,
  createAuthStore,
  createJsonAuthStorage,
  createMemoryAuthStorage,
  type AuthApi,
} from './auth.js';
import type { ApiClient } from '../api/client.js';
import type { LoginForm, Session, User } from '../types.js';

const USER: User = {
  id: 'u1',
  email: 'a@b.co',
  name: 'Ada',
  role: 'admin',
  tenantId: 't1',
  orgIds: ['o1'],
  locale: 'en',
  timezone: 'UTC',
};

function session(overrides: Partial<Session> = {}): Session {
  return {
    user: USER,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 60_000,
    permissions: ['dashboard.read', 'admin.read'],
    ...overrides,
  };
}

function makeAuthApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    login: vi.fn(async () => ({ session: session(), redirectTo: '/dashboard' })),
    register: vi.fn(async () => ({ session: session(), redirectTo: '/dashboard' })),
    refresh: vi.fn(async () => session({ accessToken: 'access-2' })),
    me: vi.fn(async () => USER),
    logout: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createAuthStore', () => {
  it('starts anonymous', () => {
    const store = createAuthStore(makeAuthApi(), createMemoryAuthStorage());
    expect(store.status).toBe('anonymous');
    expect(store.isAuthenticated()).toBe(false);
  });

  it('logs in, persists and exposes the session', async () => {
    const storage = createMemoryAuthStorage();
    const api = makeAuthApi();
    const store = createAuthStore(api, storage);
    const result = await store.login({ email: 'a@b.co', password: 'password1', remember: true });
    expect(result).toEqual({ ok: true, redirectTo: '/dashboard' });
    expect(store.status).toBe('authenticated');
    expect(store.isAuthenticated()).toBe(true);
    expect(store.getToken()).toBe('access-1');
    expect(store.getUser()?.name).toBe('Ada');
    expect(store.getSession()?.accessToken).toBe('access-1');
    expect(storage.getSession()?.accessToken).toBe('access-1');
    expect(api.login).toHaveBeenCalledOnce();
  });

  it('reports a failed login', async () => {
    const api = makeAuthApi({ login: vi.fn(async () => {
      throw new Error('bad credentials');
    }) });
    const store = createAuthStore(api, createMemoryAuthStorage());
    const result = await store.login({ email: 'a@b.co', password: 'password1', remember: false });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('bad credentials');
    expect(store.status).toBe('anonymous');
    expect(store.getState().error).toBe('bad credentials');
  });

  it('registers successfully', async () => {
    const store = createAuthStore(makeAuthApi(), createMemoryAuthStorage());
    const result = await store.register({ name: 'Ada', email: 'a@b.co', password: 'password1', storeName: 'Shop' });
    expect(result.ok).toBe(true);
    expect(store.status).toBe('authenticated');
  });

  it('registers a failure', async () => {
    const api = makeAuthApi({
      register: vi.fn(async () => {
        throw new Error('taken');
      }),
    });
    const store = createAuthStore(api, createMemoryAuthStorage());
    const result = await store.register({ name: 'Ada', email: 'a@b.co', password: 'password1', storeName: 'Shop' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('taken');
  });

  it('restores from storage when the session is valid', async () => {
    const storage = createMemoryAuthStorage();
    storage.saveSession(session());
    const store = createAuthStore(makeAuthApi(), storage);
    await store.restore();
    expect(store.status).toBe('authenticated');
  });

  it('restores anonymously when there is no session', async () => {
    const store = createAuthStore(makeAuthApi(), createMemoryAuthStorage());
    await store.restore();
    expect(store.status).toBe('anonymous');
  });

  it('refreshes an expired session during restore', async () => {
    const storage = createMemoryAuthStorage();
    storage.saveSession(session({ expiresAt: Date.now() - 1000 }));
    const api = makeAuthApi();
    const store = createAuthStore(api, storage);
    await store.restore();
    expect(store.status).toBe('authenticated');
    expect(store.getSession()?.accessToken).toBe('access-2');
    expect(storage.getSession()?.accessToken).toBe('access-2');
  });

  it('clears storage when the refresh fails during restore', async () => {
    const storage = createMemoryAuthStorage();
    storage.saveSession(session({ expiresAt: Date.now() - 1000 }));
    const api = makeAuthApi({
      refresh: vi.fn(async () => {
        throw new Error('expired');
      }),
    });
    const store = createAuthStore(api, storage);
    await store.restore();
    expect(store.status).toBe('anonymous');
    expect(storage.getSession()).toBeUndefined();
  });

  it('cannot refresh without a session', async () => {
    const store = createAuthStore(makeAuthApi(), createMemoryAuthStorage());
    const result = await store.refresh();
    expect(result.ok).toBe(false);
  });

  it('refreshes an existing session', async () => {
    const store = createAuthStore(makeAuthApi(), createMemoryAuthStorage());
    store.setSession(session());
    const result = await store.refresh();
    expect(result.ok).toBe(true);
    expect(store.getSession()?.accessToken).toBe('access-2');
  });

  it('logs out and clears everything, tolerating API failure', async () => {
    const storage = createMemoryAuthStorage();
    const api = makeAuthApi({
      logout: vi.fn(async () => {
        throw new Error('gone');
      }),
    });
    const store = createAuthStore(api, storage);
    store.setSession(session());
    await store.logout();
    expect(store.status).toBe('anonymous');
    expect(storage.getSession()).toBeUndefined();
    expect(api.logout).toHaveBeenCalledWith('access-1');
  });

  it('checks permissions against the session', async () => {
    const store = createAuthStore(makeAuthApi(), createMemoryAuthStorage());
    expect(store.hasPermission('dashboard.read')).toBe(false);
    store.setSession(session());
    expect(store.hasPermission('dashboard.read')).toBe(true);
    expect(store.hasPermission('billing.read')).toBe(false);
  });

  it('notifies subscribers of state changes', async () => {
    const store = createAuthStore(makeAuthApi(), createMemoryAuthStorage());
    const listener = vi.fn();
    store.subscribe((state) => listener(state));
    store.setSession(session());
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'authenticated' }));
  });
});

describe('createMemoryAuthStorage', () => {
  it('stores, reads and clears a session', () => {
    const storage = createMemoryAuthStorage();
    expect(storage.getSession()).toBeUndefined();
    storage.saveSession(session());
    expect(storage.getSession()?.accessToken).toBe('access-1');
    storage.clear();
    expect(storage.getSession()).toBeUndefined();
  });
});

describe('createJsonAuthStorage', () => {
  it('round-trips a session through a storage-like backend', () => {
    const map = new Map<string, string>();
    const storage = createJsonAuthStorage({
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
      removeItem: (key) => {
        map.delete(key);
      },
    });
    storage.saveSession(session());
    expect(storage.getSession()?.refreshToken).toBe('refresh-1');
    storage.clear();
    expect(storage.getSession()).toBeUndefined();
  });

  it('returns undefined for missing or corrupt values', () => {
    const map = new Map<string, string>();
    map.set('seogod.auth.session.v1', '{not-json');
    const storage = createJsonAuthStorage({
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
      removeItem: (key) => {
        map.delete(key);
      },
    });
    expect(storage.getSession()).toBeUndefined();
  });
});

describe('createAuthApi', () => {
  const stubApi = (): ApiClient => ({
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  });

  it('maps login, register, refresh, me and logout onto endpoints', async () => {
    const api = stubApi();
    const auth = createAuthApi(api);
    const form: LoginForm = { email: 'a@b.co', password: 'password1', remember: false };

    await auth.login(form);
    expect(api.post).toHaveBeenCalledWith('/api/v1/auth/login', form);

    await auth.register({ name: 'A', email: 'a@b.co', password: 'password1', storeName: 'S' });
    expect(api.post).toHaveBeenCalledWith('/api/v1/auth/register', expect.any(Object));

    await auth.refresh('rt');
    expect(api.post).toHaveBeenCalledWith('/api/v1/auth/refresh', { refreshToken: 'rt' });

    await auth.me('at');
    expect(api.get).toHaveBeenCalledWith('/api/v1/auth/me');

    await auth.logout('at');
    expect(api.post).toHaveBeenCalledWith('/api/v1/auth/logout');
  });
});

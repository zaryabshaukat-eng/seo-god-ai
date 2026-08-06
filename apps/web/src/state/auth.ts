import { createStore } from '../store.js';
import { toWebError, errorMessage } from '../errors.js';
import type { ApiClient } from '../api/client.js';
import { endpointPath } from '../api/endpoints.js';
import type { AuthStatus, LoginForm, Permission, RegisterForm, Session, User } from '../types.js';

/** Backend contract the auth store talks to. */
export interface AuthApi {
  login(input: LoginForm): Promise<{ session: Session; redirectTo: string }>;
  register(input: RegisterForm): Promise<{ session: Session; redirectTo: string }>;
  refresh(refreshToken: string): Promise<Session>;
  me(accessToken: string): Promise<User>;
  logout(accessToken: string): Promise<void>;
}

/** Persistence boundary for the session (localStorage-backed in the browser). */
export interface AuthStorage {
  getSession(): Session | undefined;
  saveSession(session: Session): void;
  clear(): void;
}

export interface AuthState {
  status: AuthStatus;
  session?: Session;
  error?: string;
}

export interface AuthActionResult {
  ok: boolean;
  error?: string;
  redirectTo?: string;
}

export interface AuthStore {
  getState(): AuthState;
  get status(): AuthStatus;
  getUser(): User | undefined;
  getSession(): Session | undefined;
  isAuthenticated(): boolean;
  hasPermission(permission: Permission): boolean;
  getToken(): string | undefined;
  login(input: LoginForm): Promise<AuthActionResult>;
  register(input: RegisterForm): Promise<AuthActionResult>;
  restore(): Promise<void>;
  refresh(): Promise<AuthActionResult>;
  logout(): Promise<void>;
  setSession(session: Session): void;
  subscribe(listener: (state: AuthState) => void): () => void;
}

const SESSION_KEY = 'seogod.auth.session.v1';

/** In-memory auth storage (SSR/tests/default). */
export function createMemoryAuthStorage(): AuthStorage {
  let session: Session | undefined;
  return {
    getSession() {
      return session;
    },
    saveSession(next: Session) {
      session = next;
    },
    clear() {
      session = undefined;
    },
  };
}

/** JSON auth storage over a Storage-like backend. */
export function createJsonAuthStorage(storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void }): AuthStorage {
  return {
    getSession() {
      const raw = storage.getItem(SESSION_KEY);
      if (!raw) {
        return undefined;
      }
      try {
        return JSON.parse(raw) as Session;
      } catch {
        return undefined;
      }
    },
    saveSession(session: Session) {
      storage.setItem(SESSION_KEY, JSON.stringify(session));
    },
    clear() {
      storage.removeItem(SESSION_KEY);
    },
  };
}

/** Auth API wired to the REST client and its auth endpoints. */
export function createAuthApi(api: ApiClient): AuthApi {
  return {
    login(input: LoginForm) {
      return api.post(endpointPath('login'), input);
    },
    register(input: RegisterForm) {
      return api.post(endpointPath('register'), input);
    },
    refresh(refreshToken: string) {
      return api.post(endpointPath('refresh'), { refreshToken });
    },
    me(_accessToken: string) {
      return api.get<User>(endpointPath('me'));
    },
    logout(_accessToken: string) {
      return api.post(endpointPath('logout'));
    },
  };
}

/** Creates the authentication store backed by an API and storage. */
export function createAuthStore(api: AuthApi, storage: AuthStorage): AuthStore {
  const store = createStore<AuthState>({ status: 'anonymous' });

  function setState(next: AuthState) {
    store.set(next);
  }

  async function login(input: LoginForm): Promise<AuthActionResult> {
    setState({ status: 'authenticating', session: store.get().session });
    try {
      const { session, redirectTo } = await api.login(input);
      storage.saveSession(session);
      setState({ status: 'authenticated', session, error: undefined });
      return { ok: true, redirectTo };
    } catch (error) {
      const message = errorMessage(toWebError(error));
      setState({ status: 'anonymous', session: undefined, error: message });
      return { ok: false, error: message };
    }
  }

  async function register(input: RegisterForm): Promise<AuthActionResult> {
    setState({ status: 'authenticating', session: store.get().session });
    try {
      const { session, redirectTo } = await api.register(input);
      storage.saveSession(session);
      setState({ status: 'authenticated', session, error: undefined });
      return { ok: true, redirectTo };
    } catch (error) {
      const message = errorMessage(toWebError(error));
      setState({ status: 'anonymous', session: undefined, error: message });
      return { ok: false, error: message };
    }
  }

  async function restore(): Promise<void> {
    const session = storage.getSession();
    if (!session) {
      setState({ status: 'anonymous', session: undefined, error: undefined });
      return;
    }
    if (session.expiresAt > Date.now()) {
      setState({ status: 'authenticated', session, error: undefined });
      return;
    }
    setState({ status: 'authenticating', session });
    const result = await refresh();
    if (!result.ok) {
      storage.clear();
      setState({ status: 'anonymous', session: undefined, error: undefined });
    }
  }

  async function refresh(): Promise<AuthActionResult> {
    const current = store.get().session;
    const refreshToken = current?.refreshToken;
    if (!refreshToken) {
      return { ok: false, error: 'No session to refresh.' };
    }
    setState({ status: 'authenticating', session: current });
    try {
      const session = await api.refresh(refreshToken);
      storage.saveSession(session);
      setState({ status: 'authenticated', session, error: undefined });
      return { ok: true };
    } catch (error) {
      const message = errorMessage(toWebError(error));
      setState({ status: 'anonymous', session: undefined, error: message });
      return { ok: false, error: message };
    }
  }

  async function logout(): Promise<void> {
    const token = store.get().session?.accessToken;
    if (token) {
      try {
        await api.logout(token);
      } catch {
        // Best-effort: the session is cleared regardless.
      }
    }
    storage.clear();
    setState({ status: 'anonymous', session: undefined, error: undefined });
  }

  function setSession(session: Session): void {
    storage.saveSession(session);
    setState({ status: 'authenticated', session, error: undefined });
  }

  return {
    getState: () => store.get(),
    get status() {
      return store.get().status;
    },
    getUser: () => store.get().session?.user,
    getSession: () => store.get().session,
    isAuthenticated: () => store.get().status === 'authenticated',
    hasPermission: (permission: Permission) => store.get().session?.permissions.includes(permission) ?? false,
    getToken: () => store.get().session?.accessToken,
    login,
    register,
    restore,
    refresh,
    logout,
    setSession,
    subscribe: (listener) => store.subscribe(listener),
  };
}

import { describe, expect, it, vi } from 'vitest';
import { renderToString } from './vdom.js';
import { CHANNELS, createWebApp } from './app.js';
import type { Session } from './types.js';
import { Permissions } from './api/endpoints.js';

const FULL = Object.values(Permissions);

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    user: {
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada',
      role: 'admin',
      tenantId: 't1',
      orgIds: ['o1'],
      locale: 'en',
      timezone: 'UTC',
    },
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    expiresAt: Date.now() + 60_000,
    permissions: FULL,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), { status });
}

function makeFetch(routes: Array<{ method: string; path: string; respond: (body: unknown) => Response }>) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = async (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const body = init?.body !== undefined ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, path: url, body });
    const route = routes.find((r) => r.method === method && url.endsWith(r.path));
    if (!route) {
      return jsonResponse({ message: 'Not found' }, 404);
    }
    return route.respond(body);
  };
  return { fetchImpl, calls };
}

describe('createWebApp', () => {
  it('composes stores and services', () => {
    const { fetchImpl } = makeFetch([]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    expect(app.auth.getState().status).toBe('anonymous');
    expect(app.router.getPath()).toBe('/');
    expect(app.theme.getTheme()).toBe('light');
    expect(app.nav.visible()).toEqual([]);
  });

  it('bounces anonymous users to the login route', () => {
    const { fetchImpl } = makeFetch([]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    app.router.navigate('/dashboard');
    expect(app.router.getPath()).toBe('/login');
  });

  it('submits a valid login, restores a session and navigates', async () => {
    const session = makeSession();
    const { fetchImpl, calls } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/login', respond: () => jsonResponse({ session, redirectTo: '/dashboard' }) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    const result = await app.submitLogin({ email: 'ada@example.com', password: 'password1', remember: false });
    expect(result.ok).toBe(true);
    expect(app.auth.isAuthenticated()).toBe(true);
    expect(app.router.getPath()).toBe('/dashboard');
    expect(calls[0]?.path.endsWith('/api/v1/auth/login')).toBe(true);
    expect((calls[0]?.body as { email: string }).email).toBe('ada@example.com');
  });

  it('navigates to the landing route when login omits redirectTo', async () => {
    const session = makeSession();
    const { fetchImpl } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/login', respond: () => jsonResponse({ session }) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    const result = await app.submitLogin({ email: 'ada@example.com', password: 'password1', remember: false });
    expect(result.ok).toBe(true);
    expect(app.router.getPath()).toBe('/dashboard');
  });

  it('rejects an invalid login form before any request', async () => {
    const fetchImpl = vi.fn();
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    const result = await app.submitLogin({ email: 'nope', password: '', remember: false });
    expect(result).toEqual({ ok: false, error: 'Enter a valid email address.' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to the password error when only the password is invalid', async () => {
    const fetchImpl = vi.fn();
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    const result = await app.submitLogin({ email: 'ada@example.com', password: 'short', remember: false });
    expect(result).toEqual({ ok: false, error: 'Password must be at least 8 characters.' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces a login failure from the server', async () => {
    const { fetchImpl } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/login', respond: () => jsonResponse({ message: 'Invalid credentials' }, 401) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    const result = await app.submitLogin({ email: 'ada@example.com', password: 'wrongpass1', remember: false });
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain('Invalid credentials');
    expect(app.auth.isAuthenticated()).toBe(false);
  });

  it('registers a new account', async () => {
    const session = makeSession({ user: { ...makeSession().user, name: 'Bo' } });
    const { fetchImpl, calls } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/register', respond: () => jsonResponse({ session, redirectTo: '/dashboard' }) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    const result = await app.submitRegister({ name: 'Bo', email: 'bo@example.com', password: 'password1', storeName: 'Store' });
    expect(result.ok).toBe(true);
    expect(app.auth.getUser()?.name).toBe('Bo');
    expect(calls[0]?.path.endsWith('/api/v1/auth/register')).toBe(true);
  });

  it('rejects registration with field errors', async () => {
    const { fetchImpl } = makeFetch([]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    const result = await app.submitRegister({ name: '', email: '', password: '', storeName: '' });
    expect(result).toEqual({ ok: false, error: 'Please fix the highlighted fields.' });
  });

  it('surfaces a registration failure from the server', async () => {
    const { fetchImpl } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/register', respond: () => jsonResponse({ message: 'Email already registered' }, 409) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    const result = await app.submitRegister({ name: 'Bo', email: 'bo@example.com', password: 'password1', storeName: 'Store' });
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain('Email already registered');
  });

  it('navigates to the landing route when registration omits redirectTo', async () => {
    const session = makeSession({ user: { ...makeSession().user, name: 'Bo' } });
    const { fetchImpl } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/register', respond: () => jsonResponse({ session }) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    const result = await app.submitRegister({ name: 'Bo', email: 'bo@example.com', password: 'password1', storeName: 'Store' });
    expect(result.ok).toBe(true);
    expect(app.router.getPath()).toBe('/dashboard');
  });

  it('submits a password reset and reports server failures', async () => {
    const { fetchImpl } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/reset-password', respond: () => jsonResponse(undefined, 204) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    const ok = await app.submitReset({ email: 'ada@example.com' });
    expect(ok).toEqual({ ok: true });

    const bad = await app.submitReset({ email: 'nope' });
    expect(bad.ok).toBe(false);
  });

  it('maps non-Error reset failures to a generic message', async () => {
    const { fetchImpl } = makeFetch([]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    app.api.post = async () => {
      throw 'boom';
    };
    const result = await app.submitReset({ email: 'ada@example.com' });
    expect(result).toEqual({ ok: false, error: 'Reset failed.' });
  });

  it('logs out and navigates to login', async () => {
    const session = makeSession();
    const { fetchImpl } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/login', respond: () => jsonResponse({ session, redirectTo: '/dashboard' }) },
      { method: 'POST', path: '/api/v1/auth/logout', respond: () => jsonResponse(undefined, 204) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    await app.submitLogin({ email: 'ada@example.com', password: 'password1', remember: false });
    await app.submitLogout();
    expect(app.auth.isAuthenticated()).toBe(false);
    expect(app.router.getPath()).toBe('/login');
  });

  it('renders public routes when anonymous', () => {
    const { fetchImpl } = makeFetch([]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    expect(renderToString(app.renderRoute('/login'))).toContain('Welcome back');
    expect(renderToString(app.renderRoute('/register'))).toContain('Create your account');
    expect(renderToString(app.renderRoute('/reset'))).toContain('Reset your password');
  });

  it('renders the public shell through render() when anonymous', () => {
    const { fetchImpl } = makeFetch([]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    const html = renderToString(app.render());
    expect(html).toContain('Welcome back');
    expect(html).not.toContain('app-shell');
  });

  it('renders the theme toggle label for the dark theme', async () => {
    const session = makeSession();
    const { fetchImpl } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/login', respond: () => jsonResponse({ session, redirectTo: '/dashboard' }) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    await app.submitLogin({ email: 'ada@example.com', password: 'password1', remember: false });
    app.theme.setPref('dark');
    const html = renderToString(app.render());
    expect(html).toContain('>Light</button>');
  });

  it('falls back to an empty chat stream and noop realtime transport', async () => {
    const { fetchImpl } = makeFetch([]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    await app.chat.send('hello');
    expect(app.chat.getMessages().map((m) => m.role)).toEqual(['user']);
    await app.realtime.connect();
    app.realtime.publish('x', 1);
    expect(app.realtime.status).toBe('connected');
    const unsubscribe = app.connectRealtime();
    unsubscribe();
    app.realtime.disconnect();
    expect(app.realtime.status).toBe('disconnected');
  });

  it('renders the full shell with navigation after login', async () => {
    const session = makeSession();
    const { fetchImpl } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/login', respond: () => jsonResponse({ session, redirectTo: '/dashboard' }) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    await app.submitLogin({ email: 'ada@example.com', password: 'password1', remember: false });
    const html = renderToString(app.render());
    expect(html).toContain('app-shell');
    expect(html).toContain('SEO GOD AI');
    expect(html).toContain('data-action="auth:logout"');
    expect(html).toContain('href="/notifications"');
    expect(html).toContain('Dashboard');
  });

  it('renders each protected route with empty state data', async () => {
    const session = makeSession();
    const { fetchImpl } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/login', respond: () => jsonResponse({ session, redirectTo: '/dashboard' }) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    await app.submitLogin({ email: 'ada@example.com', password: 'password1', remember: false });
    const cases: Array<[string, string]> = [
      ['/dashboard', 'Recent alerts'],
      ['/crawls', 'Crawl management'],
      ['/seo', 'SEO analysis'],
      ['/executions', 'Execution management'],
      ['/observability', 'Observability'],
      ['/reports', 'Reports'],
      ['/copilot', 'AI Copilot'],
      ['/admin', 'Administration'],
      ['/admin/members', 'Members'],
      ['/admin/audit', 'Audit log'],
      ['/admin/api-keys', 'API keys'],
      ['/admin/webhooks', 'Webhooks'],
      ['/admin/billing', 'Billing'],
      ['/settings', 'Settings'],
      ['/notifications', 'Notifications'],
    ];
    for (const [path, expected] of cases) {
      const html = renderToString(app.renderRoute(path));
      expect(html).toContain(expected);
    }
    expect(renderToString(app.renderRoute('/nope'))).toContain('Page not found');
  });

  it('renders the chat page with live store state', async () => {
    const session = makeSession();
    const { fetchImpl } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/login', respond: () => jsonResponse({ session, redirectTo: '/dashboard' }) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    await app.submitLogin({ email: 'ada@example.com', password: 'password1', remember: false });
    app.chat.setInput('typed');
    const html = renderToString(app.renderRoute('/copilot'));
    expect(html).toContain('>typed</textarea>');
  });

  it('connects the realtime bus and cleans up', async () => {
    const session = makeSession();
    const handlers: Array<(channel: string, payload: unknown) => void> = [];
    const transport = {
      connect: vi.fn(() => Promise.resolve()),
      disconnect: vi.fn(),
      send: vi.fn(),
      onMessage: vi.fn((handler: (channel: string, payload: unknown) => void) => {
        handlers.push(handler);
      }),
    };
    const { fetchImpl } = makeFetch([
      { method: 'POST', path: '/api/v1/auth/login', respond: () => jsonResponse({ session, redirectTo: '/dashboard' }) },
    ]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl, realtimeTransport: transport });
    await app.submitLogin({ email: 'ada@example.com', password: 'password1', remember: false });
    const unsubscribe = app.connectRealtime();
    expect(transport.connect).toHaveBeenCalled();
    expect(handlers).toHaveLength(1);
    handlers[0]?.(CHANNELS.notifications, { id: 'n1', kind: 'info', title: 'Hi', createdAt: Date.now(), read: false });
    expect(app.notifications.getItems()).toHaveLength(1);
    handlers[0]?.(CHANNELS.alerts, { id: 'a1', title: 'Down', severity: 'high', storeId: 's1', acknowledged: false });
    expect(app.ui.getState().toasts).toHaveLength(1);
    unsubscribe();
    expect(transport.disconnect).toHaveBeenCalled();
    handlers[0]?.(CHANNELS.notifications, { id: 'n2', kind: 'info', title: 'Later', createdAt: Date.now(), read: false });
    expect(app.notifications.getItems()).toHaveLength(1);
  });

  it('supports direct session injection', () => {
    const { fetchImpl } = makeFetch([]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    app.auth.setSession(makeSession());
    expect(app.auth.isAuthenticated()).toBe(true);
    expect(app.nav.visible()).toHaveLength(9);
    expect(app.nav.landing().path).toBe('/dashboard');
    expect(app.nav.groups()[0]?.group).toBe('overview');
  });

  it('toggles the theme through the store', () => {
    const { fetchImpl } = makeFetch([]);
    const app = createWebApp({ baseUrl: 'https://api.example.com', fetchImpl });
    app.theme.setPref('dark');
    expect(app.theme.getTheme()).toBe('dark');
    app.theme.toggle();
    expect(app.theme.getTheme()).toBe('light');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createRouter } from './router.js';
import { ROUTES, AUTH_ROUTES } from './routes.js';
import { Permissions } from '../api/endpoints.js';
import type { Route } from '../types.js';

const REGISTER: Route = AUTH_ROUTES[1] as Route;

function makeConfig(overrides: Partial<Parameters<typeof createRouter>[0]> = {}) {
  const permissions: string[] = [Permissions.dashboardRead];
  return {
    routes: [...AUTH_ROUTES, ...ROUTES],
    getPermissions: () => permissions,
    isAuthenticated: () => false,
    ...overrides,
  };
}

describe('createRouter', () => {
  it('resolves the initial path through the guards', () => {
    const router = createRouter(makeConfig({ initialPath: '/login' }));
    expect(router.getPath()).toBe('/login');
    expect(router.getRoute()).toMatchObject({ path: '/login' });
  });

  it('navigates to allowed routes and records history', () => {
    const router = createRouter(
      makeConfig({
        isAuthenticated: () => true,
        getPermissions: () => Object.values(Permissions),
      }),
    );
    expect(router.navigate('/dashboard')).toBe('/dashboard');
    expect(router.navigate('/seo')).toBe('/seo');
    expect(router.navigate('/crawls')).toBe('/crawls');
    expect(router.getPath()).toBe('/crawls');
    router.back();
    expect(router.getPath()).toBe('/seo');
    router.back();
    expect(router.getPath()).toBe('/dashboard');
  });

  it('bounces anonymous users away from protected routes', () => {
    const onUnauthorized = vi.fn();
    const router = createRouter(makeConfig({ onUnauthorized }));
    const resolved = router.navigate('/dashboard');
    expect(resolved).toBe('/login');
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(router.getRoute()).toMatchObject({ path: '/login' });
  });

  it('redirects authenticated users away from public routes to the landing route', () => {
    const router = createRouter(
      makeConfig({
        isAuthenticated: () => true,
        getPermissions: () => [Permissions.dashboardRead],
      }),
    );
    expect(router.navigate('/login')).toBe('/dashboard');
  });

  it('forbids routes outside the permission set and notifies onForbidden', () => {
    const onForbidden = vi.fn();
    const router = createRouter(
      makeConfig({
        isAuthenticated: () => true,
        getPermissions: () => [Permissions.dashboardRead],
        onForbidden,
      }),
    );
    const resolved = router.navigate('/seo');
    expect(resolved).toBe('/dashboard');
    expect(onForbidden).toHaveBeenCalledWith('/seo');
  });

  it('ignores unknown paths while keeping the route empty', () => {
    const router = createRouter(makeConfig({ initialPath: '/login' }));
    expect(router.navigate('/not-a-route')).toBe('/not-a-route');
    expect(router.getRoute()).toBeUndefined();
  });

  it('returns early when navigating to the current path', () => {
    const router = createRouter(makeConfig({ initialPath: '/login' }));
    expect(router.navigate('/login')).toBe('/login');
    expect(router.getPath()).toBe('/login');
  });

  it('resolve() reports the guarded target without committing', () => {
    const router = createRouter(
      makeConfig({
        isAuthenticated: () => true,
        getPermissions: () => [Permissions.dashboardRead],
      }),
    );
    expect(router.resolve('/seo')).toBe('/dashboard');
    expect(router.getPath()).toBe('/');
  });

  it('back() does nothing when history is empty', () => {
    const router = createRouter(makeConfig({ initialPath: '/login' }));
    router.back();
    expect(router.getPath()).toBe('/login');
  });

  it('exposes the landing route helpers through navigation', () => {
    const router = createRouter(makeConfig({ initialPath: '/register' }));
    expect(router.getState().path).toBe('/register');
    expect(router.getRoute()).toMatchObject({ path: '/register' });
  });

  it('notifies subscribers of route changes', () => {
    const router = createRouter(makeConfig({ initialPath: '/login' }));
    const listener = vi.fn();
    router.subscribe((state) => listener(state));
    router.navigate('/register');
    expect(listener).toHaveBeenLastCalledWith({ path: '/register', route: REGISTER });
  });
});

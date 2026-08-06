import { describe, expect, it } from 'vitest';
import {
  AUTH_ROUTES,
  GROUP_ORDER,
  ROUTES,
  canAccessRoute,
  groupedNav,
  isPublicRoute,
  landingRoute,
  routeByPath,
  visibleRoutes,
} from './routes.js';
import { Permissions } from '../api/endpoints.js';
import type { Route } from '../types.js';

const FULL_PERMISSIONS = Object.values(Permissions);

describe('routes registry', () => {
  it('defines auth and application routes', () => {
    expect(AUTH_ROUTES.map((route) => route.path)).toEqual(['/login', '/register']);
    expect(ROUTES.some((route) => route.path === '/dashboard')).toBe(true);
    expect(ROUTES.some((route) => route.path === '/copilot')).toBe(true);
  });

  it('isPublicRoute reflects the permission gate', () => {
    expect(isPublicRoute({ path: '/login', label: 'x', group: 'overview' })).toBe(true);
    expect(isPublicRoute({ path: '/dashboard', label: 'x', group: 'overview', permission: 'dashboard.read' })).toBe(false);
  });

  it('canAccessRoute grants public and permitted routes', () => {
    const route: Route = { path: '/seo', label: 'x', group: 'operations', permission: Permissions.seoRead };
    expect(canAccessRoute(route, [Permissions.seoRead])).toBe(true);
    expect(canAccessRoute(route, [Permissions.crawlRead])).toBe(false);
    expect(canAccessRoute({ path: '/login', label: 'x', group: 'overview' }, [])).toBe(true);
  });

  it('routeByPath finds static routes', () => {
    expect(routeByPath('/dashboard')?.label).toBe('Dashboard');
    expect(routeByPath('/nope')).toBeUndefined();
  });
});

describe('visibleRoutes', () => {
  it('filters routes by permissions', () => {
    const visible = visibleRoutes([Permissions.dashboardRead, Permissions.seoRead]);
    expect(visible.map((route) => route.path)).toEqual(['/dashboard', '/seo']);
  });

  it('returns everything with full permissions', () => {
    expect(visibleRoutes(FULL_PERMISSIONS)).toHaveLength(ROUTES.length);
  });
});

describe('groupedNav', () => {
  it('groups visible routes by section in canonical order', () => {
    const groups = groupedNav([Permissions.dashboardRead, Permissions.crawlRead, Permissions.reportsRead]);
    expect(groups.map((group) => group.group)).toEqual(['overview', 'operations', 'intelligence']);
    const operations = groups.find((group) => group.group === 'operations');
    expect(operations?.items.map((item) => item.route.path)).toEqual(['/crawls']);
  });

  it('omits empty sections', () => {
    const groups = groupedNav([]);
    expect(groups).toEqual([]);
  });

  it('exposes nav items with their group', () => {
    const groups = groupedNav(FULL_PERMISSIONS);
    expect(groups[0]?.items[0]).toMatchObject({ route: expect.objectContaining({ path: '/dashboard' }), group: 'overview' });
  });
});

describe('landingRoute', () => {
  it('prefers the marked landing route', () => {
    expect(landingRoute(FULL_PERMISSIONS).path).toBe('/dashboard');
  });

  it('falls back to the first visible route', () => {
    const landing = landingRoute([Permissions.crawlRead]);
    expect(landing.path).toBe('/crawls');
  });

  it('falls back to the login route when nothing is visible', () => {
    const landing = landingRoute([]);
    expect(landing.path).toBe('/login');
  });
});

describe('GROUP_ORDER', () => {
  it('orders groups overview → operations → intelligence → platform', () => {
    expect(GROUP_ORDER).toEqual(['overview', 'operations', 'intelligence', 'platform']);
  });
});

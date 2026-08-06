import { Permissions } from '../api/endpoints.js';
import type { NavItem, Permission, Route, RouteGroup } from '../types.js';

/** Public (auth) routes shown outside the authenticated shell. */
export const AUTH_ROUTES: readonly Route[] = [
  { path: '/login', label: 'Sign in', group: 'overview' },
  { path: '/register', label: 'Create account', group: 'overview' },
];

/** Authenticated application routes. */
export const ROUTES: readonly Route[] = [
  { path: '/dashboard', label: 'Dashboard', group: 'overview', icon: 'grid', permission: Permissions.dashboardRead, isLanding: true },
  { path: '/observability', label: 'Observability', group: 'overview', icon: 'activity', permission: Permissions.observabilityRead },
  { path: '/crawls', label: 'Crawl management', group: 'operations', icon: 'search', permission: Permissions.crawlRead },
  { path: '/seo', label: 'SEO analysis', group: 'operations', icon: 'bar-chart', permission: Permissions.seoRead },
  { path: '/executions', label: 'Executions', group: 'operations', icon: 'zap', permission: Permissions.executionRead },
  { path: '/reports', label: 'Reports', group: 'intelligence', icon: 'file-text', permission: Permissions.reportsRead },
  { path: '/copilot', label: 'AI Copilot', group: 'intelligence', icon: 'message', permission: Permissions.copilotRead },
  { path: '/admin', label: 'Administration', group: 'platform', icon: 'shield', permission: Permissions.adminRead },
  { path: '/settings', label: 'Settings', group: 'platform', icon: 'cog', permission: Permissions.settingsRead },
];

export const GROUP_ORDER: readonly RouteGroup[] = ['overview', 'operations', 'intelligence', 'platform'];

/** True when a route is publicly accessible (no permission gate). */
export function isPublicRoute(route: Route): boolean {
  return route.permission === undefined;
}

/** True when the user's permissions grant access to a route. */
export function canAccessRoute(route: Route, permissions: readonly Permission[]): boolean {
  return isPublicRoute(route) || permissions.includes(route.permission as Permission);
}

/** Finds a static route by path. */
export function routeByPath(path: string, routes: readonly Route[] = ROUTES): Route | undefined {
  return routes.find((route) => route.path === path);
}

/** Routes the user can actually see, preserving registry order. */
export function visibleRoutes(permissions: readonly Permission[]): Route[] {
  return ROUTES.filter((route) => canAccessRoute(route, permissions));
}

/** Navigation grouped by section (only sections that have visible items). */
export function groupedNav(permissions: readonly Permission[]): Array<{ group: RouteGroup; items: NavItem[] }> {
  const visible = visibleRoutes(permissions);
  const groups: Array<{ group: RouteGroup; items: NavItem[] }> = [];
  for (const group of GROUP_ORDER) {
    const items = visible.filter((route) => route.group === group).map((route) => ({ route, group }));
    if (items.length > 0) {
      groups.push({ group, items });
    }
  }
  return groups;
}

/** Default post-login route: the landing route, else the first visible route. */
export function landingRoute(permissions: readonly Permission[]): Route {
  const visible = visibleRoutes(permissions);
  return (
    visible.find((route) => route.isLanding === true) ??
    visible[0] ?? { path: '/login', label: 'Sign in', group: 'overview' }
  );
}

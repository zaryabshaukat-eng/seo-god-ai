import { createStore } from '../store.js';
import { canAccessRoute, isPublicRoute, landingRoute, routeByPath } from './routes.js';
import type { Permission, Route } from '../types.js';

export interface RouterConfig {
  routes: readonly Route[];
  getPermissions: () => readonly Permission[];
  isAuthenticated: () => boolean;
  /** Called when an unauthenticated user hits a protected route. */
  onUnauthorized?: () => void;
  /** Called when an authenticated user hits a route they cannot access. */
  onForbidden?: (path: string) => void;
  initialPath?: string;
}

export interface RouterState {
  path: string;
  route?: Route;
}

export interface Router {
  getState(): RouterState;
  getPath(): string;
  getRoute(): Route | undefined;
  /** Navigates, applying auth/permission guards; returns the resolved path. */
  navigate(path: string): string;
  /** Resolves the guards for a path without committing navigation. */
  resolve(path: string): string;
  back(): void;
  subscribe(listener: (state: RouterState) => void): () => void;
}

/**
 * Client-side router with role-based guards. Protected routes bounce to
 * `/login` when anonymous and to the landing route when forbidden.
 */
export function createRouter(config: RouterConfig): Router {
  const initial = guardedResolve(config, config.initialPath ?? '/');
  const store = createStore<RouterState>({ path: initial.path, route: initial.route });
  const history: string[] = [];

  return {
    getState: () => store.get(),
    getPath: () => store.get().path,
    getRoute: () => store.get().route,
    navigate(path: string) {
      const resolved = guardedResolve(config, path);
      if (resolved.path === store.get().path) {
        return resolved.path;
      }
      history.push(store.get().path);
      store.set(resolved);
      return resolved.path;
    },
    resolve(path: string) {
      return guardedResolve(config, path).path;
    },
    back() {
      const previous = history.pop();
      if (previous !== undefined) {
        store.set(guardedResolve(config, previous));
      }
    },
    subscribe: (listener) => store.subscribe(listener),
  };
}

function guardedResolve(config: RouterConfig, path: string): RouterState {
  const route = routeByPath(path, config.routes);
  if (!route) {
    return { path, route: undefined };
  }
  if (isPublicRoute(route)) {
    if (config.isAuthenticated()) {
      const landing = landingRoute(config.getPermissions());
      return { path: landing.path, route: landing };
    }
    return { path, route };
  }
  if (!config.isAuthenticated()) {
    config.onUnauthorized?.();
    return { path: '/login', route: routeByPath('/login', config.routes) };
  }
  if (!canAccessRoute(route, config.getPermissions())) {
    config.onForbidden?.(path);
    const landing = landingRoute(config.getPermissions());
    return { path: landing.path, route: landing };
  }
  return { path, route };
}

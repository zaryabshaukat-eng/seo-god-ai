/**
 * Minimal path router. Routes are registered as `METHOD /path/:param` and
 * matched in registration order against the request method + pathname.
 * `:param` segments match exactly one path segment.
 */

import type { RequestContext } from './context.js';
import { NotFoundError } from './errors.js';

export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
  path: string;
}

export type RouteHandler = (ctx: RequestContext) => Promise<void>;

interface RegisteredRoute {
  method: string;
  segments: Array<string | null>;
  handler: RouteHandler;
  path: string;
}

/** Splits a path into segments, dropping empty entries from leading slashes. */
export function splitPath(path: string): string[] {
  const segments = path.split('/');
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.length > 0) out.push(segment);
  }
  return out;
}

/** Compiles a `/path/:with/params` template into segment patterns. */
export function compilePath(path: string): Array<string | null> {
  return splitPath(path).map((segment) => (segment.startsWith(':') ? null : segment));
}

/** True when the path template contains a `:param` placeholder. */
export function hasParams(path: string): boolean {
  return splitPath(path).some((segment) => segment.startsWith(':'));
}

export class Router {
  private readonly routes: RegisteredRoute[] = [];

  /** Registers a handler for `method` at `path`. */
  on(method: string, path: string, handler: RouteHandler): this {
    this.routes.push({ method: method.toUpperCase(), segments: compilePath(path), handler, path });
    return this;
  }

  get routesCount(): number {
    return this.routes.length;
  }

  /**
   * Finds the first route matching `method` + `pathname`. Returns `null` when
   * no route matches; callers distinguish 404 (no path) from 405 (path known,
   * method unknown) via {@link Router.pathExists}.
   */
  match(method: string, pathname: string): RouteMatch | null {
    const target = splitPath(pathname);
    for (const route of this.routes) {
      if (route.segments.length !== target.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const pattern = route.segments[index];
        const value = target[index];
        if (pattern === null) {
          if (value === undefined) {
            matched = false;
            break;
          }
          params[paramName(route.path, index)] = decodeURIComponent(value);
          continue;
        }
        if (value !== pattern) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      if (route.method !== method.toUpperCase()) continue;
      return { handler: route.handler, params, path: route.path };
    }
    return null;
  }

  /** True when any route has the same path shape as `pathname`. */
  pathExists(pathname: string): boolean {
    const target = splitPath(pathname);
    return this.routes.some((route) => route.segments.length === target.length && segmentsMatch(route.segments, target));
  }

  /** True when any route serves `method` at the path shape of `pathname`. */
  methodExists(method: string, pathname: string): boolean {
    const target = splitPath(pathname);
    return this.routes.some(
      (route) =>
        route.method === method.toUpperCase() &&
        route.segments.length === target.length &&
        segmentsMatch(route.segments, target),
    );
  }

  /** Every registered route, for OpenAPI generation and SDK rendering. */
  list(): ReadonlyArray<{ method: string; path: string; handler: RouteHandler }> {
    return this.routes.map((route) => ({ method: route.method, path: route.path, handler: route.handler }));
  }
}

function paramName(path: string, index: number): string {
  const segments = splitPath(path);
  const segment = segments[index];
  if (segment === undefined) return 'param';
  return segment.slice(1);
}

function segmentsMatch(patterns: Array<string | null>, target: string[]): boolean {
  for (let index = 0; index < patterns.length; index += 1) {
    const pattern = patterns[index];
    const value = target[index];
    if (pattern !== null && value !== pattern) return false;
  }
  return true;
}

/** Dispatch helper: throws 404 when no route exists for the pathname. */
export function requireRouteMatch(router: Router, method: string, pathname: string): RouteMatch {
  const match = router.match(method, pathname);
  if (match === null) {
    throw new NotFoundError(`No route for ${method} ${pathname}.`);
  }
  return match;
}

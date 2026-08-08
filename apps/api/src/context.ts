/**
 * Request context: everything a handler and its middleware know about the
 * current request — identity, tenant scope, effective permissions, parsed
 * input and scratch state. The context is immutable-ish; middleware builds it
 * up front and handlers read from it.
 */

import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import type { Logger } from '@seogod/logging';
import type { HttpMethod } from './http.js';
import { NotFoundError } from './errors.js';

/** An authenticated caller: a user session or a machine API key. */
export interface Principal {
  kind: 'user' | 'api_key';
  /** User id (user principals). */
  userId?: string;
  /** API key id (machine principals). */
  keyId?: string;
  name: string;
  email?: string;
  role: string;
  tenantId: string;
  /** Effective platform permission strings granted to the principal. */
  permissions: string[];
}

export interface RequestContext {
  requestId: string;
  method: HttpMethod;
  pathname: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingHttpHeaders;
  body: unknown;
  ip: string;
  logger: Logger;
  startedAt: number;
  state: Map<string, unknown>;
  /** Server response the handler writes to. */
  res: ServerResponse;
  /** Authenticated caller; set by the auth middleware. */
  principal?: Principal;
  /** Resolved tenant id; set by the tenant middleware. */
  tenantId?: string;
}

/** Creates a fresh request context shell. */
export function createContext(input: {
  requestId: string;
  method: HttpMethod;
  pathname: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: unknown;
  ip: string;
  logger: Logger;
  res: ServerResponse;
}): RequestContext {
  return {
    requestId: input.requestId,
    method: input.method,
    pathname: input.pathname,
    query: input.query,
    params: {},
    headers: input.headers,
    body: input.body,
    ip: input.ip,
    logger: input.logger,
    startedAt: Date.now(),
    state: new Map(),
    res: input.res,
  };
}

/** Types a parsed request body as `T` or `undefined` when absent. */
export function bodyAs<T>(ctx: RequestContext): T | undefined {
  return ctx.body as T | undefined;
}

/**
 * Reads a matched path parameter. The router only calls handlers after a
 * successful match, so missing params are unreachable — but with
 * `noUncheckedIndexedAccess` TypeScript cannot see that, so this helper
 * narrows the type and throws a canonical 404 if ever misused.
 */
export function requireParam(ctx: RequestContext, name: string): string {
  const value = ctx.params[name];
  if (value === undefined) {
    throw new NotFoundError(`Missing '${name}' path parameter.`);
  }
  return value;
}

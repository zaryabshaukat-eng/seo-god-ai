/**
 * API SDK. Two pieces:
 *
 *  1. `ApiClient` + `ApiRequestError` — a small typed fetch wrapper used by
 *     both generated clients and callers that prefer to drive the transport
 *     directly. `stream` returns the raw `Response` so SSE readers can parse
 *     the event stream themselves.
 *  2. `generateSdkSource` — renders a standalone TypeScript client from the
 *     router's route table (method-per-route, camelCased operation ids). The
 *     rendered source is served at `/api/v1/sdk.ts`.
 */

import type { Platform } from './platform.js';
import type { Router } from './router.js';
import { guard } from './guards.js';
import { sendText } from './http.js';
import { operationIdOf } from './openapi.js';

export interface ApiRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Path parameter substitution for `:param` templates. */
  path?: Record<string, string | number>;
}

export interface ApiClientOptions {
  baseUrl: string;
  token?: string | (() => string | undefined);
  headers?: Record<string, string>;
}

/** Canonical API error thrown by {@link ApiClient} on non-2xx responses. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(status: number, code: string, message: string, body: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** Typed JSON client for the SEO GOD AI API. */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string | (() => string | undefined) | undefined;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.defaultHeaders = { ...options.headers };
  }

  /** Issues a JSON request and decodes the response envelope. */
  async request<T>(method: string, path: string, options: ApiRequestOptions = {}): Promise<T> {
    const response = await this.fetchResponse(method, path, options);
    const body = (await response.text().catch(() => '')) as string;
    if (response.status === 204 || body.length === 0) {
      return undefined as T;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      throw new ApiRequestError(response.status, 'invalid_response', 'Response was not valid JSON.', body);
    }
    if (!response.ok) {
      const envelope = parsed as { error?: { code?: string; message?: string } };
      throw new ApiRequestError(
        response.status,
        envelope.error?.code ?? 'request_failed',
        envelope.error?.message ?? `Request failed with status ${response.status}.`,
        parsed,
      );
    }
    return parsed as T;
  }

  /** Issues a request and returns the raw response for streaming consumers. */
  async fetchResponse(method: string, path: string, options: ApiRequestOptions = {}): Promise<Response> {
    const url = this.urlFor(resolvePathParams(path, options.path), options.query);
    const headers: Record<string, string> = { ...this.defaultHeaders };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const token = typeof this.token === 'function' ? this.token() : this.token;
    if (token !== undefined && token.length > 0) {
      headers.authorization = `Bearer ${token}`;
    }
    Object.assign(headers, options.headers);
    return fetch(url, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }

  private urlFor(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const target = path.replace(/^\/+/, '/');
    const relative = target.startsWith('/') ? target.slice(1) : target;
    const url = new URL(relative, `${this.baseUrl}/`);
    if (query !== undefined) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }
}

function resolvePathParams(path: string, params: Record<string, string | number> | undefined): string {
  if (params === undefined) return path;
  let resolved = path;
  for (const [key, value] of Object.entries(params)) {
    resolved = resolved.replace(new RegExp(`:${key}(?=/)`), encodeURIComponent(String(value)));
    resolved = resolved.replace(new RegExp(`:${key}$`), encodeURIComponent(String(value)));
  }
  return resolved;
}

/** Options accepted by every generated SDK method. */
export interface SdkMethodOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Renders the standalone TypeScript SDK source for the registered routes. */
export function generateSdkSource(router: Router): string {
  const methods = sdkMethods(router);
  const body = methods.map((entry) => renderMethod(entry)).join('\n');

  return `/**
 * SEO GOD AI API SDK — generated from the live route table. Do not edit.
 * Regenerate with: GET /api/v1/sdk.ts
 */

export interface ApiRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  path?: Record<string, string | number>;
}

export interface SdkMethodOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  path?: Record<string, string | number>;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
  constructor(status: number, code: string, message: string, body: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string | (() => string | undefined) | undefined;
  private readonly defaultHeaders: Record<string, string>;
  constructor(options: { baseUrl: string; token?: string | (() => string | undefined); headers?: Record<string, string> }) {
    this.baseUrl = options.baseUrl.replace(/\\/+$/, '');
    this.token = options.token;
    this.defaultHeaders = { ...options.headers };
  }
  private urlFor(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const relative = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(relative, this.baseUrl + '/');
    if (query !== undefined) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
  async request<T>(method: string, path: string, options: ApiRequestOptions = {}): Promise<T> {
    let target = path;
    if (options.path !== undefined) {
      for (const [key, value] of Object.entries(options.path)) {
        target = target.replace(new RegExp(':(' + key + ')(?=/|$)'), encodeURIComponent(String(value)));
      }
    }
    const url = this.urlFor(target, options.query);
    const headers: Record<string, string> = { ...this.defaultHeaders };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const token = typeof this.token === 'function' ? this.token() : this.token;
    if (token !== undefined && token.length > 0) headers.authorization = 'Bearer ' + token;
    Object.assign(headers, options.headers);
    const response = await fetch(url, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    if (response.status === 204 || text.length === 0) return undefined as T;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new ApiRequestError(response.status, 'invalid_response', 'Response was not valid JSON.', text);
    }
    if (!response.ok) {
      const envelope = parsed as { error?: { code?: string; message?: string } };
      throw new ApiRequestError(response.status, envelope.error?.code ?? 'request_failed', envelope.error?.message ?? 'Request failed.', parsed);
    }
    return parsed as T;
  }
  async stream(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<Response> {
    const url = this.urlFor(path, query);
    const headers: Record<string, string> = { ...this.defaultHeaders };
    const token = typeof this.token === 'function' ? this.token() : this.token;
    if (token !== undefined && token.length > 0) headers.authorization = 'Bearer ' + token;
    return fetch(url, { method: 'GET', headers });
  }
}

export class SeoGodSdk {
  readonly client: ApiClient;
  constructor(options: { baseUrl: string; token?: string | (() => string | undefined); headers?: Record<string, string> }) {
    this.client = new ApiClient(options);
  }
${body}
}
`;
}

interface SdkMethod {
  name: string;
  httpMethod: string;
  path: string;
  hasPathParams: boolean;
}

function sdkMethods(router: Router): SdkMethod[] {
  const seen = new Map<string, number>();
  const methods: SdkMethod[] = [];
  for (const route of router.list()) {
    let name = operationIdOf(route.method, route.path);
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
      name = 'call' + name;
    }
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count > 0) {
      name = `${name}_${count + 1}`;
    }
    methods.push({
      name,
      httpMethod: route.method.toLowerCase(),
      path: route.path.replace(/^\/api\/v1/, ''),
      hasPathParams: route.path.includes(':'),
    });
  }
  return methods;
}

function renderMethod(method: SdkMethod): string {
  const args: string[] = [];
  if (method.hasPathParams) {
    args.push('path: Record<string, string | number>');
  }
  args.push('options?: SdkMethodOptions');
  const callOptions = method.hasPathParams ? `{ ...options, path }` : 'options ?? {}';
  return `  /** ${method.httpMethod.toUpperCase()} ${method.path} */
  ${method.name}(${args.join(', ')}): Promise<unknown> {
    return this.client.request('${method.httpMethod.toUpperCase()}', '${method.path}', ${callOptions});
  }`;
}

/** Registers the SDK discovery endpoint. */
export function registerSdkRoutes(platform: Platform, router: Router): void {
  router.on('GET', '/api/v1/sdk.ts', guard(platform, { auth: false }, async (ctx) => {
    const source = generateSdkSource(router);
    sendText(ctx.res, 200, source, 'text/typescript; charset=utf-8');
  }));
}

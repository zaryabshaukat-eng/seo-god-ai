/**
 * Shared test harness. Boots a real `ApiServer` on a random port and exposes
 * helpers for authenticated HTTP calls, so integration tests exercise the full
 * middleware pipeline over actual sockets (not mocked handlers).
 */

import { createLogger } from '@seogod/logging';
import { Platform, type PlatformOptions } from '../src/platform.js';
import { ApiServer, type ApiServerOptions } from '../src/server.js';

export interface Harness {
  platform: Platform;
  server: ApiServer;
  baseUrl: string;
  stop: () => Promise<void>;
}

export interface ApiResult {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
}

let seq = 0;

/** A platform with deterministic clock/ids and a silent logger by default. */
export function createPlatform(options: PlatformOptions = {}): Platform {
  return new Platform({
    now: options.now ?? (() => new Date('2026-01-15T12:00:00.000Z')),
    id: options.id ?? (() => `id_${++seq}_${Math.random().toString(36).slice(2, 8)}`),
    logger: options.logger ?? createLogger({ name: 'api-test', level: 'silent' }),
    fetchImpl: options.fetchImpl ?? (async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    config: options.config,
    model: options.model,
  });
}

/** Boots a server bound to an ephemeral port. */
export async function boot(options: { platform?: Platform; server?: ApiServerOptions } = {}): Promise<Harness> {
  const platform = options.platform ?? createPlatform();
  const server = new ApiServer(platform, { port: 0, ...options.server });
  await server.start();
  return {
    platform,
    server,
    baseUrl: `http://127.0.0.1:${server.boundPort ?? 0}`,
    stop: async () => {
      await server.stop();
    },
  };
}

/** Issued HTTP request helper that decodes the canonical JSON envelope. */
export async function api(
  harness: Harness,
  path: string,
  options: { method?: string; token?: string; apiKey?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined && options.body !== null) {
    headers['content-type'] = 'application/json';
  }
  if (options.token !== undefined) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.apiKey !== undefined) {
    headers['x-api-key'] = options.apiKey;
  }
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined || options.body === null ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: unknown = text;
  if (!options.raw) {
    try {
      body = text.length === 0 ? undefined : (JSON.parse(text) as unknown);
    } catch {
      body = text;
    }
  }
  return { status: response.status, headers: response.headers, body, text };
}

/** Registers a tenant + owner and returns the full auth session. */
export async function register(
  harness: Harness,
  overrides: { name?: string; email?: string; password?: string; storeName?: string } = {},
): Promise<{ session: Record<string, any>; token: string }> {
  const suffix = (overrides.email?.split('@')[0] ?? `u${++seq}`) + `${seq}`;
  const result = await api(harness, '/api/v1/auth/register', {
    method: 'POST',
    body: {
      name: overrides.name ?? 'Test User',
      email: overrides.email ?? `${suffix}@example.com`,
      password: overrides.password ?? 'password123',
      storeName: overrides.storeName ?? `Store ${seq}`,
    },
  });
  const session = result.body as Record<string, any>;
  return { session, token: session.accessToken as string };
}

/** Logs in as the given email. */
export async function login(harness: Harness, email: string, password = 'password123'): Promise<Record<string, any>> {
  const result = await api(harness, '/api/v1/auth/login', { method: 'POST', body: { email, password } });
  return result.body as Record<string, any>;
}

export async function stopQuietly(harness: Harness): Promise<void> {
  try {
    await harness.stop();
  } catch {
    // server already closed
  }
}

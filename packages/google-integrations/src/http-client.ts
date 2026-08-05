/**
 * Low-level HTTP client for Google REST APIs.
 *
 * Handles authentication header injection (`Authorization: Bearer ...`),
 * API-key query params, request timeouts and retries with exponential
 * backoff for the transient failures Google reports (429, 5xx, network).
 * Every failure surfaces as a typed `GoogleError`.
 */

import {
  GoogleApiError,
  GoogleAuthError,
  GoogleNetworkError,
  GoogleRateLimitError,
  GoogleValidationError,
  type GoogleError,
  type GoogleErrorContext,
} from './errors.js';
import type { GoogleMetrics } from './metrics.js';

export interface GoogleHttpClientOptions {
  /** Base URL for the API being called (e.g. `https://www.googleapis.com`). */
  baseUrl: string;
  /** Injectable fetch for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Max retries for transient failures (429/5xx/network). Default 3. */
  maxRetries?: number;
  /** Base exponential-backoff delay in ms. Default 500. */
  retryBackoffMs?: number;
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Shared metrics counters; omitted to skip instrumentation. */
  metrics?: GoogleMetrics;
}

export interface GoogleRequestOptions {
  /** OAuth access token; sent as `Authorization: Bearer <token>`. */
  accessToken?: string;
  /** API key; appended as a `key` query parameter. */
  apiKey?: string;
  /** Query parameters merged into the request URL (arrays repeat the key). */
  query?: Record<string, string | string[]>;
  /** JSON body for POST/PUT/PATCH requests. */
  json?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Per-request override for the timeout. */
  timeoutMs?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Typed JSON client over Google's REST endpoints. One instance per API
 * product (each gets its own `baseUrl`).
 */
export class GoogleHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly timeoutMs: number;
  private readonly metrics?: GoogleMetrics;

  constructor(options: GoogleHttpClientOptions) {
    if (!options.baseUrl) {
      throw new GoogleValidationError('baseUrl is required to create an HTTP client', {
        operation: 'http.create',
      });
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_BACKOFF_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.metrics = options.metrics;
  }

  async get(path: string, options: GoogleRequestOptions = {}): Promise<unknown> {
    return this.request('GET', path, options);
  }

  async post(path: string, options: GoogleRequestOptions = {}): Promise<unknown> {
    return this.request('POST', path, options);
  }

  async put(path: string, options: GoogleRequestOptions = {}): Promise<unknown> {
    return this.request('PUT', path, options);
  }

  private async request(method: string, path: string, options: GoogleRequestOptions): Promise<unknown> {
    let attempt = 0;

    for (;;) {
      const outcome = await this.send(method, path, options);
      if (outcome.ok) {
        this.metrics?.requests();
        return outcome.value;
      }
      this.metrics?.requestFailures();
      if (!outcome.error.retryable || attempt >= this.maxRetries) {
        throw outcome.error;
      }

      const delay = outcome.retryAfterMs ?? retryDelay(this.retryBackoffMs, attempt);
      await sleep(delay);
      attempt += 1;
    }
  }

  private async send(
    method: string,
    path: string,
    options: GoogleRequestOptions,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: GoogleError; retryAfterMs?: number }> {
    const context: GoogleErrorContext = { operation: 'http.request' };

    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, item);
        }
      } else {
        url.searchParams.set(key, value);
      }
    }
    if (options.apiKey) {
      url.searchParams.set('key', options.apiKey);
    }

    const headers: Record<string, string> = { ...options.headers };
    if (options.accessToken) {
      headers.Authorization = `Bearer ${options.accessToken}`;
    }
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
        signal: controller.signal,
      });
    } catch (cause) {
      const error = isAbortError(cause)
        ? new GoogleApiError(`Request to ${method} ${path} timed out`, {
            status: 0,
            context,
            retryable: true,
            cause,
          })
        : new GoogleNetworkError(`Network error while calling Google API ${method} ${path}`, context, cause);
      return { ok: false, error };
    } finally {
      clearTimeout(timeout);
    }

    const requestId = response.headers.get('x-goog-request-id') ?? response.headers.get('x-request-id') ?? undefined;
    context.requestId = requestId;
    context.status = response.status;

    const bodyText = await response.text().catch(() => '');

    if (response.status === 401) {
      return {
        ok: false,
        error: new GoogleAuthError('Google API authentication failed; the access token may be expired', {
          ...context,
          status: response.status,
          body: bodyText,
        }),
      };
    }
    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));
      return {
        ok: false,
        retryAfterMs: retryAfterSeconds != null ? retryAfterSeconds * 1000 : undefined,
        error: new GoogleRateLimitError('Google API rate limit exceeded', context, retryAfterSeconds),
      };
    }
    if (response.status >= 500) {
      return {
        ok: false,
        error: new GoogleApiError('Google API server error', {
          status: response.status,
          requestId,
          body: bodyText,
          context,
          retryable: true,
        }),
      };
    }
    if (response.status >= 400) {
      return {
        ok: false,
        error: new GoogleApiError('Google API error', {
          status: response.status,
          requestId,
          body: bodyText,
          context,
        }),
      };
    }

    if (bodyText === '') {
      return { ok: true, value: null };
    }
    try {
      return { ok: true, value: JSON.parse(bodyText) as unknown };
    } catch {
      return {
        ok: false,
        error: new GoogleApiError('Google API response was not valid JSON', {
          status: response.status,
          requestId,
          body: bodyText,
          context,
        }),
      };
    }
  }
}

function retryDelay(baseMs: number, attempt: number): number {
  const exponential = baseMs * 2 ** attempt;
  const capped = Math.min(exponential, MAX_BACKOFF_MS);
  return Math.round(capped * (0.5 + Math.random() * 0.5));
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

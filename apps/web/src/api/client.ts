import { WebNetworkError, fromApiError, toWebError } from '../errors.js';
import type { ApiErrorBody, HttpMethod } from '../types.js';

export interface ApiClientConfig {
  baseUrl: string;
  /** Injectable fetch; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Returns the current access token, if any. */
  getToken?: () => string | undefined;
  /** Called when a request fails with 401 (e.g. to trigger re-login). */
  onAuthError?: (error: Error) => void;
  /** Default per-request timeout in ms. */
  timeoutMs?: number;
  /** Additional headers merged into every request. */
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  /** Per-request timeout in ms (overrides the default). */
  timeoutMs?: number;
  /** External abort signal. */
  signal?: AbortSignal;
  /** Treat the response as JSON. */
  json?: boolean;
}

export interface ApiClient {
  request<T>(method: HttpMethod, path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  del<T>(path: string, options?: RequestOptions): Promise<T>;
}

/** Default request timeout when none is configured. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Typed HTTP client for the SEO GOD AI API. Handles authentication headers,
 * JSON serialization, timeout/abort handling and normalization of failures
 * into the WebError hierarchy.
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const token = config.getToken?.();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...config.defaultHeaders,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? timeoutMs);
    const onAbort = () => controller.abort();
    const external = options.signal;
    external?.addEventListener('abort', onAbort, { once: true });

    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new WebNetworkError(
          `Request to ${method} ${path} timed out after ${options.timeoutMs ?? timeoutMs}ms.`,
          error,
        );
      }
      throw new WebNetworkError(`Request to ${method} ${path} failed.`, error);
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    }

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      const error = fromApiError(response.status, errorBody);
      if (response.status === 401) {
        config.onAuthError?.(error);
      }
      throw error;
    }

    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    if (text.length === 0) {
      return undefined as T;
    }
    if (options.json === false) {
      return text as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw toWebError(error, `Response from ${method} ${path} was not valid JSON.`);
    }
  }

  async function readErrorBody(response: Response): Promise<ApiErrorBody> {
    try {
      const text = await response.text();
      if (text.length === 0) {
        return {};
      }
      return JSON.parse(text) as ApiErrorBody;
    } catch {
      return {};
    }
  }

  return {
    request,
    get<T>(path: string, options?: RequestOptions) {
      return request<T>('GET', path, undefined, options);
    },
    post<T>(path: string, body?: unknown, options?: RequestOptions) {
      return request<T>('POST', path, body, options);
    },
    put<T>(path: string, body?: unknown, options?: RequestOptions) {
      return request<T>('PUT', path, body, options);
    },
    patch<T>(path: string, body?: unknown, options?: RequestOptions) {
      return request<T>('PATCH', path, body, options);
    },
    del<T>(path: string, options?: RequestOptions) {
      return request<T>('DELETE', path, undefined, options);
    },
  };
}

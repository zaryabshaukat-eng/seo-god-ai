import { endpointPath, type EndpointName } from '../api/endpoints.js';
import type { ApiClient } from '../api/client.js';
import type { HttpMethod } from '../types.js';

type Params = Record<string, string | number>;

export interface ApiFunctions {
  get<T>(name: EndpointName, params?: Params): Promise<T>;
  post<T>(name: EndpointName, body?: unknown, params?: Params): Promise<T>;
  put<T>(name: EndpointName, body?: unknown, params?: Params): Promise<T>;
  patch<T>(name: EndpointName, body?: unknown, params?: Params): Promise<T>;
  del<T>(name: EndpointName, params?: Params): Promise<T>;
}

/**
 * Convenience wrappers that resolve endpoint names (with path params) onto a
 * typed API client. Keeps feature modules free of URL bookkeeping.
 */
export function createApiFunctions(api: ApiClient): ApiFunctions {
  function call<T>(method: HttpMethod, name: EndpointName, body: unknown, params?: Params): Promise<T> {
    return api.request<T>(method, endpointPath(name, params), body);
  }

  return {
    get: <T>(name: EndpointName, params?: Params) => call<T>('GET', name, undefined, params),
    post: <T>(name: EndpointName, body?: unknown, params?: Params) => call<T>('POST', name, body, params),
    put: <T>(name: EndpointName, body?: unknown, params?: Params) => call<T>('PUT', name, body, params),
    patch: <T>(name: EndpointName, body?: unknown, params?: Params) => call<T>('PATCH', name, body, params),
    del: <T>(name: EndpointName, params?: Params) => call<T>('DELETE', name, undefined, params),
  };
}

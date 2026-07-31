import {
  ShopifyApiError,
  ShopifyNetworkError,
  ShopifyRateLimitError,
  ShopifyValidationError,
  type ShopifyError,
  type ShopifyErrorContext,
} from './errors.js';
import { RateThrottler } from './throttler.js';
import { sleep } from './sleep.js';

export interface GraphQLClientOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  /** Injectable fetch for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Max retries for transient failures (429/5xx/network). Default 3. */
  maxRetries?: number;
  /** Base exponential-backoff delay in ms. Default 500. */
  retryBackoffMs?: number;
  /** Shared rate-limit tracker for the store. A new one is created if omitted. */
  throttler?: RateThrottler;
}

export interface GraphQLRequest {
  query: string;
  variables?: Record<string, unknown>;
  /** Shopify requires operationName to match a named operation in the document. */
  operationName?: string;
  /** Per-request override for the max retries. */
  maxRetries?: number;
}

export interface GraphQLResponseError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: Array<string | number>;
  extensions?: { code?: string };
}

export interface GraphQLResult<T> {
  data?: T;
  errors?: GraphQLResponseError[];
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

/**
 * Thin, safe client for the Shopify Admin GraphQL API.
 *
 * - Sends the access token header on every request.
 * - Throttles requests against the store's rate-limit bucket.
 * - Retries 429 (honoring `Retry-After`), 5xx and GraphQL `THROTTLED`
 *   responses with exponential backoff + jitter.
 * - Never crashes silently: every failure is a typed `ShopifyError` with
 *   shop/request context attached.
 */
export class ShopifyGraphQLClient {
  private readonly shopDomain: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly throttler: RateThrottler;
  private readonly endpoint: string;

  constructor(options: GraphQLClientOptions) {
    if (!options.shopDomain || !options.accessToken || !options.apiVersion) {
      throw new ShopifyValidationError(
        'shopDomain, accessToken and apiVersion are required to create a GraphQL client',
      );
    }
    this.shopDomain = options.shopDomain;
    this.accessToken = options.accessToken;
    this.apiVersion = options.apiVersion;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_BACKOFF_MS;
    this.throttler = options.throttler ?? new RateThrottler();
    this.endpoint = `https://${options.shopDomain}/admin/api/${options.apiVersion}/graphql.json`;
  }

  async request<T>(req: GraphQLRequest): Promise<GraphQLResult<T>> {
    const maxRetries = req.maxRetries ?? this.maxRetries;
    let attempt = 0;

    for (;;) {
      await this.throttler.waitIfNeeded();
      const outcome = await this.send(req);

      if (outcome.ok) {
        return outcome.value as GraphQLResult<T>;
      }
      if (!outcome.error.retryable || attempt >= maxRetries) {
        throw outcome.error;
      }

      const delay = outcome.retryAfterMs ?? retryDelay(this.retryBackoffMs, attempt);
      await sleep(delay);
      attempt += 1;
    }
  }

  private async send(
    req: GraphQLRequest,
  ): Promise<
    | { ok: true; value: GraphQLResult<unknown> }
    | { ok: false; error: ShopifyError; retryAfterMs?: number }
  > {
    const context: ShopifyErrorContext = {
      shopDomain: this.shopDomain,
      operation: 'graphql.request',
    };

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': this.accessToken,
        },
        body: JSON.stringify({
          query: req.query,
          variables: req.variables ?? {},
          operationName: req.operationName,
        }),
      });
    } catch (cause) {
      return {
        ok: false,
        error: new ShopifyNetworkError(
          'Network error while calling the Shopify GraphQL API',
          context,
          cause,
        ),
      };
    }

    this.throttler.update(response.headers.get('x-shopify-shop-api-call-limit'));
    const requestId = response.headers.get('x-request-id') ?? undefined;
    context.requestId = requestId;
    context.status = response.status;

    const bodyText = await response.text().catch(() => '');

    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));
      return {
        ok: false,
        retryAfterMs: retryAfterSeconds != null ? retryAfterSeconds * 1000 : undefined,
        error: new ShopifyRateLimitError(
          'Shopify API rate limit exceeded',
          context,
          retryAfterSeconds,
        ),
      };
    }
    if (response.status >= 500) {
      return {
        ok: false,
        error: new ShopifyApiError('Shopify API server error', {
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
        error: new ShopifyApiError('Shopify API error', {
          status: response.status,
          requestId,
          body: bodyText,
          context,
        }),
      };
    }

    let json: GraphQLResult<unknown>;
    try {
      json = JSON.parse(bodyText) as GraphQLResult<unknown>;
    } catch {
      return {
        ok: false,
        error: new ShopifyApiError('Shopify GraphQL response was not valid JSON', {
          status: response.status,
          requestId,
          body: bodyText,
          context,
        }),
      };
    }

    if (json.errors?.some((error) => error.extensions?.code === 'THROTTLED')) {
      return {
        ok: false,
        error: new ShopifyRateLimitError('Shopify GraphQL rate limit exceeded', context),
      };
    }

    return { ok: true, value: json };
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

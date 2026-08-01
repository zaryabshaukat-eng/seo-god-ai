const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 250;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export interface FetcherOptions {
  userAgent: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface FetchResult {
  /** URL that was requested. */
  url: string;
  /** URL of the final response after redirects. */
  finalUrl: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  bodyBytes: number;
  redirectChain: string[];
  ttfbMs: number;
  responseTimeMs: number;
  contentType: string | null;
  charset: string | null;
  /** Machine-readable error code, or null on success. */
  error: string | null;
}

export type FetchErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'BODY_TOO_LARGE'
  | 'TOO_MANY_REDIRECTS';

/**
 * HTTP client for the crawler: manual redirect following with a hop limit,
 * retries with exponential backoff on transient failures (network errors,
 * timeouts, 5xx, 429), a hard response-size cap, and charset-aware decoding.
 * Compression (gzip/deflate/br) is handled transparently by the underlying
 * fetch implementation.
 */
export class Fetcher {
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(options: FetcherOptions) {
    this.userAgent = options.userAgent;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.sleepImpl = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Fetches a single URL, following redirects and applying retries. */
  async fetch(url: string): Promise<FetchResult> {
    const startMs = this.now();
    let currentUrl = url;
    const redirectChain: string[] = [];

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const { response } = await this.requestOnce(currentUrl, startMs);
        const ttfbMs = this.now() - startMs;

        if (REDIRECT_STATUSES.has(response.status)) {
          if (redirectChain.includes(currentUrl)) {
            return this.failure(url, startMs, redirectChain, 'TOO_MANY_REDIRECTS', 0);
          }
          const location = response.headers.get('location');
          if (location !== null && redirectChain.length < this.maxRedirects) {
            redirectChain.push(currentUrl);
            currentUrl = new URL(location, currentUrl).toString();
            continue;
          }
          return this.failure(
            url,
            startMs,
            redirectChain,
            'TOO_MANY_REDIRECTS',
            response.status,
          );
        }

        if (RETRYABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
          const waitMs = this.retryDelayMs(response, attempt);
          await this.sleepImpl(waitMs);
          continue;
        }

        const body = await this.readBody(response, url, currentUrl, startMs, redirectChain, ttfbMs);
        if (body === null) {
          return this.failure(url, startMs, redirectChain, 'BODY_TOO_LARGE', response.status);
        }
        return body;
      } catch (err) {
        if (attempt >= this.maxRetries) {
          const code = isTimeoutError(err) ? 'TIMEOUT' : 'NETWORK_ERROR';
          return this.failure(url, startMs, redirectChain, code, 0);
        }
        await this.sleepImpl(this.backoffMs * 2 ** attempt);
      }
    }
    return this.failure(url, startMs, redirectChain, 'NETWORK_ERROR', 0);
  }

  private async requestOnce(
    url: string,
    startMs: number,
  ): Promise<{ response: Response; ttfbMs: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': this.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'en',
        },
      });
      return { response, ttfbMs: this.now() - startMs };
    } finally {
      clearTimeout(timer);
    }
  }

  private async readBody(
    response: Response,
    requestedUrl: string,
    finalUrl: string,
    startMs: number,
    redirectChain: string[],
    ttfbMs: number,
  ): Promise<FetchResult | null> {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > this.maxResponseBytes) return null;

    const { contentType, charset } = parseContentType(response.headers.get('content-type'));
    const body = decodeBody(buffer, charset);

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      url: requestedUrl,
      finalUrl: response.url !== '' ? response.url : finalUrl,
      statusCode: response.status,
      headers,
      body,
      bodyBytes: buffer.byteLength,
      redirectChain,
      ttfbMs,
      responseTimeMs: this.now() - startMs,
      contentType,
      charset,
      error: null,
    };
  }

  private failure(
    url: string,
    startMs: number,
    redirectChain: string[],
    error: FetchErrorCode,
    statusCode: number,
  ): FetchResult {
    return {
      url,
      finalUrl: url,
      statusCode,
      headers: {},
      body: '',
      bodyBytes: 0,
      redirectChain,
      ttfbMs: 0,
      responseTimeMs: this.now() - startMs,
      contentType: null,
      charset: null,
      error,
    };
  }

  private retryDelayMs(response: Response, attempt: number): number {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter !== null && /^\d+$/.test(retryAfter)) {
      return Number(retryAfter) * 1000;
    }
    if (retryAfter !== null) {
      const date = Date.parse(retryAfter);
      if (!Number.isNaN(date)) {
        const delta = date - Date.now();
        if (delta > 0) return delta;
      }
    }
    return this.backoffMs * 2 ** attempt;
  }
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function parseContentType(value: string | null): {
  contentType: string | null;
  charset: string | null;
} {
  if (value === null) return { contentType: null, charset: null };
  const parts = value.split(';').map((part) => part.trim());
  const charsetMatch = parts.find((part) => part.toLowerCase().startsWith('charset='));
  const charset = charsetMatch?.slice('charset='.length).replace(/^"|"$/g, '').trim() ?? null;
  return { contentType: parts[0] || null, charset };
}

function decodeBody(buffer: ArrayBuffer, charset: string | null): string {
  if (charset === null || charset === '') {
    return Buffer.from(buffer).toString('utf8');
  }
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return Buffer.from(buffer).toString('utf8');
  }
}

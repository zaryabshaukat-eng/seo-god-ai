import { describe, expect, it } from 'vitest';
import { Fetcher } from './fetcher.js';
import { RateLimiter } from './rate-limiter.js';

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const init = input instanceof Request ? { signal: input.signal } : undefined;
    return handler(url, init);
  }) as typeof fetch;
}

const nowSource = (() => {
  let t = 1000;
  return {
    advance: (ms: number) => {
      t += ms;
    },
    fn: () => t,
  };
})();

describe('Fetcher', () => {
  it('fetches a page and decodes metadata', async () => {
    const fetchImpl = mockFetch(async () =>
      new Response('<html><title>Hi</title></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
    const fetcher = new Fetcher({
      userAgent: 'SeoGodBot',
      fetchImpl,
      sleep: async () => {},
      now: nowSource.fn,
    });
    const result = await fetcher.fetch('https://acme.myshopify.com/products/hat');
    expect(result.statusCode).toBe(200);
    expect(result.contentType).toBe('text/html');
    expect(result.charset).toBe('utf-8');
    expect(result.body).toContain('<title>Hi</title>');
    expect(result.bodyBytes).toBeGreaterThan(0);
    expect(result.error).toBeNull();
    expect(result.headers['content-type']).toContain('text/html');
  });

  it('follows redirects and records the chain', async () => {
    const fetchImpl = mockFetch(async (url) => {
      if (url === 'https://acme.myshopify.com/a') {
        return new Response('', {
          status: 301,
          headers: { location: '/products/hat' },
        });
      }
      return new Response('<h1>Hat</h1>', { status: 200 });
    });
    const fetcher = new Fetcher({ userAgent: 'SeoGodBot', fetchImpl, sleep: async () => {} });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.statusCode).toBe(200);
    expect(result.redirectChain).toEqual(['https://acme.myshopify.com/a']);
    expect(result.finalUrl).toBe('https://acme.myshopify.com/products/hat');
  });

  it('fails on too many redirects', async () => {
    const fetchImpl = mockFetch(async () =>
      new Response('', { status: 302, headers: { location: '/loop' } }),
    );
    const fetcher = new Fetcher({ userAgent: 'SeoGodBot', fetchImpl, maxRedirects: 3 });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.error).toBe('TOO_MANY_REDIRECTS');
  });

  it('fails on a redirect loop', async () => {
    const fetchImpl = mockFetch(async (url) =>
      new Response('', { status: 302, headers: { location: url === 'https://acme.myshopify.com/b' ? '/a' : '/b' } }),
    );
    const fetcher = new Fetcher({ userAgent: 'SeoGodBot', fetchImpl });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.error).toBe('TOO_MANY_REDIRECTS');
  });

  it('retries a 500 then succeeds', async () => {
    let calls = 0;
    const fetchImpl = mockFetch(async () => {
      calls += 1;
      return calls < 3 ? new Response('err', { status: 500 }) : new Response('ok', { status: 200 });
    });
    const fetcher = new Fetcher({
      userAgent: 'SeoGodBot',
      fetchImpl,
      maxRetries: 4,
      backoffMs: 1,
      sleep: async () => {},
    });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.statusCode).toBe(200);
    expect(calls).toBe(3);
  });

  it('honours Retry-After on 429', async () => {
    let calls = 0;
    const fetchImpl = mockFetch(async () => {
      calls += 1;
      return calls === 1
        ? new Response('slow down', { status: 429, headers: { 'retry-after': '2' } })
        : new Response('ok', { status: 200 });
    });
    const fetcher = new Fetcher({
      userAgent: 'SeoGodBot',
      fetchImpl,
      maxRetries: 2,
      sleep: async () => {},
    });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.statusCode).toBe(200);
  });

  it('reports a network error after exhausting retries', async () => {
    const fetchImpl = mockFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const fetcher = new Fetcher({
      userAgent: 'SeoGodBot',
      fetchImpl,
      maxRetries: 2,
      backoffMs: 1,
      sleep: async () => {},
    });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.error).toBe('NETWORK_ERROR');
    expect(result.statusCode).toBe(0);
  });

  it('reports a timeout after exhausting retries', async () => {
    const fetchImpl = mockFetch(async () => {
      const error = new Error('aborted') as Error & { name: string };
      error.name = 'AbortError';
      throw error;
    });
    const fetcher = new Fetcher({
      userAgent: 'SeoGodBot',
      fetchImpl,
      maxRetries: 1,
      backoffMs: 1,
      sleep: async () => {},
    });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.error).toBe('TIMEOUT');
  });

  it('reports BODY_TOO_LARGE when the response exceeds the cap', async () => {
    const fetchImpl = mockFetch(async () => new Response('x'.repeat(100), { status: 200 }));
    const fetcher = new Fetcher({
      userAgent: 'SeoGodBot',
      fetchImpl,
      maxResponseBytes: 10,
    });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.error).toBe('BODY_TOO_LARGE');
  });

  it('records timings via the injected clock', async () => {
    const fetchImpl = mockFetch(async () => new Response('ok', { status: 200 }));
    const now = nowSource.fn;
    const fetcher = new Fetcher({ userAgent: 'SeoGodBot', fetchImpl, now });
    const before = now();
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(result.responseTimeMs).toBeLessThanOrEqual(now() - before + 1);
  });

  it('decodes UTF-8 when no charset is advertised', async () => {
    const fetchImpl = mockFetch(
      async () => new Response('<p>héllo</p>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const fetcher = new Fetcher({ userAgent: 'SeoGodBot', fetchImpl });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.contentType).toBe('text/html');
    expect(result.charset).toBeNull();
    expect(result.body).toContain('héllo');
  });

  it('falls back to UTF-8 for an unrecognized charset', async () => {
    const fetchImpl = mockFetch(async () =>
      new Response('<p>hi</p>', { status: 200, headers: { 'content-type': 'text/html; charset=x-not-real' } }),
    );
    const fetcher = new Fetcher({ userAgent: 'SeoGodBot', fetchImpl });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.charset).toBe('x-not-real');
    expect(result.body).toContain('hi');
  });

  it('fails on a redirect without a Location header', async () => {
    const fetchImpl = mockFetch(async () => new Response('', { status: 302 }));
    const fetcher = new Fetcher({ userAgent: 'SeoGodBot', fetchImpl });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.error).toBe('TOO_MANY_REDIRECTS');
  });

  it('retries after a transient network error', async () => {
    let calls = 0;
    const fetchImpl = mockFetch(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return new Response('ok', { status: 200 });
    });
    const fetcher = new Fetcher({
      userAgent: 'SeoGodBot',
      fetchImpl,
      maxRetries: 2,
      backoffMs: 1,
      sleep: async () => {},
    });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.error).toBeNull();
    expect(result.statusCode).toBe(200);
    expect(calls).toBe(2);
  });

  it('honours a Retry-After HTTP-date on 503', async () => {
    const retryAfter = new Date(Date.now() + 5_000).toUTCString();
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = mockFetch(async () => {
      calls += 1;
      return calls === 1
        ? new Response('down', { status: 503, headers: { 'retry-after': retryAfter } })
        : new Response('ok', { status: 200 });
    });
    const fetcher = new Fetcher({
      userAgent: 'SeoGodBot',
      fetchImpl,
      maxRetries: 1,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.statusCode).toBe(200);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(0);
  });

  it('uses the response URL when available', async () => {
    const response = new Response('<h1>ok</h1>', { status: 200 });
    Object.defineProperty(response, 'url', { value: 'https://acme.myshopify.com/products/hat', configurable: true });
    const fetchImpl = mockFetch(async () => response);
    const fetcher = new Fetcher({ userAgent: 'SeoGodBot', fetchImpl });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.finalUrl).toBe('https://acme.myshopify.com/products/hat');
  });

  it('can be constructed without a custom fetch implementation', () => {
    const fetcher = new Fetcher({ userAgent: 'SeoGodBot' });
    expect(fetcher).toBeInstanceOf(Fetcher);
  });

  it('uses the default sleeper when none is provided', async () => {
    let calls = 0;
    const fetchImpl = mockFetch(async () => {
      calls += 1;
      return calls === 1 ? new Response('err', { status: 503 }) : new Response('ok', { status: 200 });
    });
    const fetcher = new Fetcher({ userAgent: 'SeoGodBot', fetchImpl, maxRetries: 1, backoffMs: 1 });
    const result = await fetcher.fetch('https://acme.myshopify.com/a');
    expect(result.statusCode).toBe(200);
  });
});

describe('RateLimiter', () => {
  it('allows the first request immediately', () => {
    const limiter = new RateLimiter({ rateLimitMs: 500, now: () => 0 });
    expect(limiter.pendingDelayMs()).toBe(0);
  });

  it('reports pending delay once a slot is taken', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const limiter = new RateLimiter({
      rateLimitMs: 500,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    await limiter.acquire();
    expect(limiter.pendingDelayMs()).toBe(500);
    await limiter.acquire();
    expect(sleeps).toEqual([500]);
    expect(t).toBe(500);
  });

  it('updates the rate limit', () => {
    const limiter = new RateLimiter({ rateLimitMs: 100, now: () => 0 });
    limiter.setRateLimitMs(1000);
    expect(limiter.pendingDelayMs()).toBe(0);
    limiter.setRateLimitMs(0);
    expect(limiter.pendingDelayMs()).toBe(0);
  });

  it('works with default clock and sleeper', async () => {
    const limiter = new RateLimiter({ rateLimitMs: 1 });
    await limiter.acquire();
    expect(limiter.pendingDelayMs()).toBeLessThanOrEqual(1);
  });
});

import { describe, expect, it } from 'vitest';
import { RobotsStore, RobotsTxt } from './robots.js';

describe('RobotsTxt.parse', () => {
  it('parses groups, rules and sitemaps', () => {
    const content = [
      'User-agent: *',
      'Disallow: /admin',
      'Allow: /admin/public',
      'Crawl-delay: 10',
      '',
      'User-agent: SeoGodBot',
      'Disallow: /checkout',
      '',
      'Sitemap: https://acme.myshopify.com/sitemap.xml',
      'Sitemap: https://acme.myshopify.com/sitemap_products.xml',
    ].join('\n');
    const robots = RobotsTxt.parse(content);
    expect(robots.hasRules).toBe(true);
    expect(robots.getSitemaps()).toEqual([
      'https://acme.myshopify.com/sitemap.xml',
      'https://acme.myshopify.com/sitemap_products.xml',
    ]);
    expect(robots.crawlDelayFor('seogodbot')).toBe(10);
    expect(robots.crawlDelayFor('googlebot')).toBe(10);
  });

  it('ignores comments and blank lines', () => {
    const robots = RobotsTxt.parse('# header\n\nUser-agent: *\nDisallow: /admin # comment\n');
    expect(robots.hasRules).toBe(true);
    expect(robots.isAllowed('https://acme.myshopify.com/admin', 'bot')).toBe(false);
  });

  it('returns an allow-all set for empty input', () => {
    const robots = RobotsTxt.parse('');
    expect(robots.hasRules).toBe(false);
    expect(robots.isAllowed('https://acme.myshopify.com/anything', 'bot')).toBe(true);
  });

  it('skips lines without colons and directives before a user-agent', () => {
    const robots = RobotsTxt.parse('some plain text\nDisallow: /early\nUser-agent: *\nDisallow: /admin\n');
    expect(robots.hasRules).toBe(true);
    expect(robots.isAllowed('https://acme.myshopify.com/early', 'bot')).toBe(true);
    expect(robots.isAllowed('https://acme.myshopify.com/admin', 'bot')).toBe(false);
  });

  it('returns a null crawl delay when none is declared', () => {
    const robots = RobotsTxt.parse('User-agent: *\nDisallow: /admin\n');
    expect(robots.crawlDelayFor('bot')).toBeNull();
  });

  it('honours a user-agent specific crawl delay', () => {
    const robots = RobotsTxt.parse(
      'User-agent: SeoGodBot\nCrawl-delay: 4\n\nUser-agent: *\nDisallow: /admin\n',
    );
    expect(robots.crawlDelayFor('SeoGodBot')).toBe(4);
    expect(robots.crawlDelayFor('googlebot')).toBeNull();
  });
});

describe('RobotsTxt.isAllowed', () => {
  const robots = RobotsTxt.parse(
    [
      'User-agent: *',
      'Disallow: /admin',
      'Disallow: /checkouts',
      'Allow: /admin/public',
      'Disallow: /account/*?view=*',
      'User-agent: SeoGodBot',
      'Disallow: /pages/secret',
    ].join('\n'),
  );

  it('allows paths not covered by a rule', () => {
    expect(robots.isAllowed('https://acme.myshopify.com/products/hat', 'any-bot')).toBe(true);
  });

  it('disallows matched prefixes', () => {
    expect(robots.isAllowed('https://acme.myshopify.com/admin/settings', 'any-bot')).toBe(false);
    expect(robots.isAllowed('https://acme.myshopify.com/checkouts/abc', 'any-bot')).toBe(false);
  });

  it('prefers longer allow rules over shorter disallow rules', () => {
    expect(robots.isAllowed('https://acme.myshopify.com/admin/public/dashboard', 'any-bot')).toBe(
      true,
    );
  });

  it('applies the exact user agent before the wildcard group', () => {
    expect(robots.isAllowed('https://acme.myshopify.com/pages/secret', 'SeoGodBot')).toBe(false);
    expect(robots.isAllowed('https://acme.myshopify.com/pages/secret', 'googlebot')).toBe(true);
  });

  it('returns false for non-http(s) or invalid URLs', () => {
    expect(robots.isAllowed('ftp://acme.myshopify.com/x', 'bot')).toBe(false);
    expect(robots.isAllowed('not a url', 'bot')).toBe(false);
  });
});

describe('RobotsTxt wildcards', () => {
  it('supports * and trailing $', () => {
    const robots = RobotsTxt.parse('User-agent: *\nDisallow: /products/*?q=*\nDisallow: /api$');
    expect(robots.isAllowed('https://acme.myshopify.com/products/hat?q=x', 'bot')).toBe(false);
    expect(robots.isAllowed('https://acme.myshopify.com/products/hat?r=y', 'bot')).toBe(true);
    expect(robots.isAllowed('https://acme.myshopify.com/api', 'bot')).toBe(false);
    expect(robots.isAllowed('https://acme.myshopify.com/api/v1', 'bot')).toBe(true);
  });
});

describe('RobotsStore', () => {
  it('fetches and caches per origin', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('User-agent: *\nDisallow: /private\n', { status: 200 });
    }) as typeof fetch;
    const store = new RobotsStore({ fetchImpl, maxAgeMs: 60_000 });

    const robots = await store.forUrl('https://acme.myshopify.com/products/a', 'seogodbot');
    expect(robots.isAllowed('https://acme.myshopify.com/private/x', 'seogodbot')).toBe(false);

    await store.forUrl('https://acme.myshopify.com/products/b', 'seogodbot');
    expect(calls).toBe(1);
  });

  it('returns allow-all on network failure and non-200 responses', async () => {
    const failingFetch = (async () => {
      throw new Error('boom');
    }) as typeof fetch;
    const failingStore = new RobotsStore({ fetchImpl: failingFetch });
    const robots = await failingStore.forUrl('https://acme.myshopify.com/x', 'bot');
    expect(robots.hasRules).toBe(false);

    const notFound = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    const notFoundStore = new RobotsStore({ fetchImpl: notFound });
    expect((await notFoundStore.forUrl('https://acme.myshopify.com/x', 'bot')).hasRules).toBe(false);
  });

  it('honours maxAgeMs and clear()', async () => {
    let now = 0;
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('User-agent: *\n', { status: 200 });
    }) as typeof fetch;
    const store = new RobotsStore({ fetchImpl, maxAgeMs: 100, now: () => now });

    await store.forUrl('https://acme.myshopify.com/x', 'bot');
    now = 50;
    await store.forUrl('https://acme.myshopify.com/y', 'bot');
    expect(calls).toBe(1);

    now = 200;
    await store.forUrl('https://acme.myshopify.com/z', 'bot');
    expect(calls).toBe(2);

    store.clear();
    await store.forUrl('https://acme.myshopify.com/w', 'bot');
    expect(calls).toBe(3);
  });

  it('returns allow-all for invalid URLs', async () => {
    const store = new RobotsStore();
    const robots = await store.forUrl('not a url', 'bot');
    expect(robots.hasRules).toBe(false);
  });

  it('normalizes origins including explicit ports', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      expect(String(input)).toContain(':8443');
      return new Response('User-agent: *\n', { status: 200 });
    }) as typeof fetch;
    const store = new RobotsStore({ fetchImpl });
    const robots = await store.forUrl('https://acme.myshopify.com:8443/products/a', 'bot');
    expect(robots.hasRules).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  classifyUrl,
  getOrigin,
  isCrawlableUrl,
  isInternalUrl,
  makeUrlRecord,
  normalizeUrl,
  pageTypePriority,
} from './urls.js';

describe('normalizeUrl', () => {
  it('lowercases the host and drops the fragment', () => {
    expect(normalizeUrl('HTTPS://Acme.Myshopify.com/#frag')).toBe('https://acme.myshopify.com/');
  });

  it('strips default ports', () => {
    expect(normalizeUrl('https://acme.myshopify.com:443/a')).toBe('https://acme.myshopify.com/a');
    expect(normalizeUrl('http://acme.myshopify.com:80/a')).toBe('http://acme.myshopify.com/a');
    expect(normalizeUrl('http://acme.myshopify.com:8080/a')).toBe('http://acme.myshopify.com:8080/a');
    expect(normalizeUrl('https://acme.myshopify.com:8443/a')).toBe('https://acme.myshopify.com:8443/a');
  });

  it('removes trailing slashes except on the root path', () => {
    expect(normalizeUrl('https://acme.myshopify.com/products/')).toBe(
      'https://acme.myshopify.com/products',
    );
    expect(normalizeUrl('https://acme.myshopify.com/collections/all/')).toBe(
      'https://acme.myshopify.com/collections/all',
    );
    expect(normalizeUrl('https://acme.myshopify.com/')).toBe('https://acme.myshopify.com/');
  });

  it('drops tracking parameters and sorts the rest', () => {
    expect(
      normalizeUrl('https://acme.myshopify.com/products/a?utm_source=x&b=2&a=1&fbclid=zz'),
    ).toBe('https://acme.myshopify.com/products/a?a=1&b=2');
  });

  it('resolves relative URLs against the base', () => {
    expect(normalizeUrl('/products/a', 'https://acme.myshopify.com/')).toBe(
      'https://acme.myshopify.com/products/a',
    );
  });

  it('returns null for invalid or non-http(s) URLs', () => {
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('ftp://acme.com/a')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('getOrigin', () => {
  it('returns the normalized origin', () => {
    expect(getOrigin('https://Acme.Myshopify.com:8443/a')).toBe('https://acme.myshopify.com:8443');
  });

  it('returns null for invalid URLs', () => {
    expect(getOrigin('nope')).toBeNull();
    expect(getOrigin('mailto:x@y.com')).toBeNull();
  });
});

describe('classifyUrl', () => {
  it('classifies Shopify path shapes', () => {
    expect(classifyUrl('https://acme.myshopify.com/')).toBe('homepage');
    expect(classifyUrl('https://acme.myshopify.com/products/hat')).toBe('product');
    expect(classifyUrl('https://acme.myshopify.com/collections/all')).toBe('collection');
    expect(classifyUrl('https://acme.myshopify.com/blogs/news')).toBe('blog');
    expect(classifyUrl('https://acme.myshopify.com/blogs/news/post')).toBe('article');
    expect(classifyUrl('https://acme.myshopify.com/pages/about')).toBe('page');
    expect(classifyUrl('https://acme.myshopify.com/policies/privacy')).toBe('policy');
    expect(classifyUrl('https://acme.myshopify.com/search?q=hat')).toBe('search');
    expect(classifyUrl('https://acme.myshopify.com/cart')).toBe('other');
    expect(classifyUrl('bad url')).toBe('other');
  });
});

describe('pageTypePriority', () => {
  it('prioritizes products and collections over static pages', () => {
    expect(pageTypePriority('homepage')).toBeLessThan(pageTypePriority('product'));
    expect(pageTypePriority('product')).toBeLessThan(pageTypePriority('collection'));
    expect(pageTypePriority('collection')).toBeLessThan(pageTypePriority('other'));
  });
});

describe('makeUrlRecord', () => {
  it('builds a seeded record with top priority', () => {
    const record = makeUrlRecord('https://acme.myshopify.com/', 0, true);
    expect(record).not.toBeNull();
    expect(record?.type).toBe('homepage');
    expect(record?.seed).toBe(true);
    expect(record?.priority).toBe(0);
  });

  it('prioritizes shallow, high-value pages first', () => {
    const deepProduct = makeUrlRecord('https://acme.myshopify.com/products/a', 5);
    const shallowPage = makeUrlRecord('https://acme.myshopify.com/pages/about', 1);
    expect((deepProduct?.priority ?? 0) > (shallowPage?.priority ?? 0)).toBe(true);
  });

  it('returns null for invalid URLs', () => {
    expect(makeUrlRecord('nope')).toBeNull();
  });
});

describe('isInternalUrl', () => {
  it('matches on origin only', () => {
    expect(
      isInternalUrl('https://acme.myshopify.com/products/a', 'https://acme.myshopify.com/'),
    ).toBe(true);
    expect(
      isInternalUrl('https://evil.example.com/products/a', 'https://acme.myshopify.com/'),
    ).toBe(false);
  });
});

describe('isCrawlableUrl', () => {
  const origin = 'https://acme.myshopify.com';

  it('accepts HTML pages on the same origin', () => {
    expect(isCrawlableUrl('https://acme.myshopify.com/products/hat', origin)).toBe(true);
    expect(isCrawlableUrl('https://acme.myshopify.com/', origin)).toBe(true);
  });

  it('rejects external, asset and junk URLs', () => {
    expect(isCrawlableUrl('https://evil.example.com/products/hat', origin)).toBe(false);
    expect(isCrawlableUrl('https://acme.myshopify.com/hat.png', origin)).toBe(false);
    expect(isCrawlableUrl('https://acme.myshopify.com/theme.css', origin)).toBe(false);
    expect(isCrawlableUrl('https://acme.myshopify.com/cart', origin)).toBe(false);
    expect(isCrawlableUrl('https://acme.myshopify.com/checkout/1', origin)).toBe(false);
    expect(isCrawlableUrl('https://acme.myshopify.com/account/login', origin)).toBe(false);
    expect(isCrawlableUrl('not a url', origin)).toBe(false);
  });
});

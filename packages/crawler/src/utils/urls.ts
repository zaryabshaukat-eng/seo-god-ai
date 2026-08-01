import type { PageType, UrlRecord } from '../types.js';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
]);

/**
 * Normalizes an absolute or relative URL into a canonical form suitable for
 * deduplication: lowercase host, default ports removed, fragments stripped,
 * tracking parameters dropped, remaining query parameters sorted and the
 * trailing slash removed (except for the root path).
 */
export function normalizeUrl(input: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';

  const params = new URLSearchParams();
  for (const [key, value] of url.searchParams.entries()) {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) params.append(key, value);
  }
  params.sort();
  url.search = params.size > 0 ? params.toString() : '';

  const host = url.hostname.toLowerCase();
  let port = url.port;
  if ((url.protocol === 'http:' && port === '80') || (url.protocol === 'https:' && port === '443')) {
    port = '';
  }

  let path = url.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path === '') path = '/';

  return `${url.protocol}//${host}${port ? `:${port}` : ''}${path}${url.search}`;
}

/** Returns the normalized origin (scheme + host + port) of a URL, or null. */
export function getOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}`;
  } catch {
    return null;
  }
}

/**
 * Classifies a normalized URL by its Shopify path shape. Unknown paths are
 * classified `other`.
 */
export function classifyUrl(urlString: string): PageType {
  let path: string;
  try {
    path = new URL(urlString).pathname;
  } catch {
    return 'other';
  }
  if (path === '/') return 'homepage';
  if (path.startsWith('/products/')) return 'product';
  if (path.startsWith('/collections/')) return 'collection';
  if (path.startsWith('/blogs/')) {
    const segments = path.split('/').filter(Boolean);
    return segments.length >= 3 ? 'article' : 'blog';
  }
  if (path.startsWith('/pages/')) return 'page';
  if (path.startsWith('/policies/')) return 'policy';
  if (path === '/search' || path.startsWith('/search/')) return 'search';
  return 'other';
}

const TYPE_PRIORITY: Record<PageType, number> = {
  homepage: 0,
  product: 1,
  collection: 2,
  page: 3,
  article: 4,
  blog: 5,
  policy: 6,
  search: 7,
  other: 8,
};

/** Computes the crawl priority for a URL record (lower = crawled first). */
export function pageTypePriority(type: PageType): number {
  return TYPE_PRIORITY[type];
}

/**
 * Builds a {@link UrlRecord} for a normalized URL, resolving its page type
 * and priority. Returns null for invalid or non-http(s) URLs.
 */
export function makeUrlRecord(urlString: string, depth = 0, seed = false): UrlRecord | null {
  const url = normalizeUrl(urlString);
  if (url === null) return null;
  const type = classifyUrl(url);
  return {
    url,
    type,
    depth,
    priority: seed ? 0 : depth * 10 + pageTypePriority(type),
    seed,
  };
}

/** Whether `candidate` belongs to the same origin as `base`. */
export function isInternalUrl(candidate: string, base: string): boolean {
  return getOrigin(candidate) === getOrigin(base);
}

const NON_HTML_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|pdf|zip|rar|gz|css|js|mjs|woff2?|ttf|otf|eot|mp[34]|mov|avi|webm|docx?|xlsx?|pptx?)$/i;

const JUNK_PREFIXES = ['/cart', '/checkout', '/account', '/cdn-cgi/', '/apps/'];

/**
 * Whether a URL is worth crawling: same-origin, HTTP(S), an HTML page (no
 * asset file extension) and outside Shopify's junk/transactional paths.
 */
export function isCrawlableUrl(urlString: string, origin: string): boolean {
  if (!isInternalUrl(urlString, origin)) return false;
  const path = new URL(urlString).pathname;
  if (NON_HTML_EXTENSIONS.test(path)) return false;
  return !JUNK_PREFIXES.some((prefix) => path.startsWith(prefix));
}

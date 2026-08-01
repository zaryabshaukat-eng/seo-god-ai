/**
 * Output sanitization helpers for values that will be embedded in HTML
 * (meta tags, generated page content) or used as filenames/paths.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes HTML-significant characters so the value is safe as text content. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Strips characters that would break out of an HTML attribute context. */
export function sanitizeHtmlAttr(value: string): string {
  return value.replace(/["'`<>\r\n\t]/g, '');
}

/** Safe, single token; rejects absolute/relative path syntax and traversal. */
export function sanitizeFilename(value: string): string {
  const cleaned = value
    .replace(/[\\/]/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '');
  return cleaned === '' ? 'file' : cleaned;
}

/** Collapses whitespace runs and trims. Useful for meta descriptions. */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Truncates to `max` characters with an ellipsis, respecting word end. */
export function truncate(value: string, max: number): string {
  if (max <= 0) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Only http/https URLs with no embedded credentials are considered safe to
 * follow, link, or embed (e.g. as a Shopify image URL).
 */
export function isSafeUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.username === '' && url.password === '';
}

import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  isSafeUrl,
  normalizeWhitespace,
  sanitizeFilename,
  sanitizeHtmlAttr,
  truncate,
} from './sanitize.js';

describe('escapeHtml', () => {
  it('escapes all HTML-significant characters', () => {
    expect(escapeHtml(`<script>"'&`)).toBe('&lt;script&gt;&quot;&#39;&amp;');
  });

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('plain text')).toBe('plain text');
  });
});

describe('sanitizeHtmlAttr', () => {
  it('strips quote, backtick, angle and whitespace-control characters', () => {
    expect(sanitizeHtmlAttr(`onclick="alert('x')"\`>`)).toBe('onclick=alert(x)');
  });

  it('keeps alphanumerics and spaces', () => {
    expect(sanitizeHtmlAttr('Hello world 123')).toBe('Hello world 123');
  });
});

describe('sanitizeFilename', () => {
  it('neutralizes path separators and traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('-..-etc-passwd');
    expect(sanitizeFilename('a/b\\c')).toBe('a-b-c');
  });

  it('replaces unsafe characters with underscores', () => {
    expect(sanitizeFilename('my report: 2026!')).toBe('my_report__2026_');
  });

  it('falls back when the result is empty', () => {
    expect(sanitizeFilename('...')).toBe('file');
    expect(sanitizeFilename('')).toBe('file');
  });
});

describe('normalizeWhitespace', () => {
  it('collapses runs and trims', () => {
    expect(normalizeWhitespace('  hello\n\t  world  ')).toBe('hello world');
  });
});

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('short', 100)).toBe('short');
    expect(truncate('exact', 5)).toBe('exact');
  });

  it('truncates long strings with an ellipsis', () => {
    const result = truncate('a b c d e f g', 7);
    expect(result).toBe('a b c…');
    expect(result.length).toBeLessThanOrEqual(7);
  });

  it('handles non-positive max', () => {
    expect(truncate('abc', 0)).toBe('');
    expect(truncate('abc', -5)).toBe('');
  });
});

describe('isSafeUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeUrl('https://cdn.example.com/img.png')).toBe(true);
    expect(isSafeUrl('http://example.com/path')).toBe(true);
  });

  it('rejects non-http schemes', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('ftp://example.com/file')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>')).toBe(false);
  });

  it('rejects URLs with embedded credentials', () => {
    expect(isSafeUrl('https://user:pass@example.com')).toBe(false);
    expect(isSafeUrl('https://user@example.com')).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('not a url')).toBe(false);
    expect(isSafeUrl('//example.com')).toBe(false);
  });
});

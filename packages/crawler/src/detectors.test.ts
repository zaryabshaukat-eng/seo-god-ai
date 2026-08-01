import { describe, expect, it } from 'vitest';
import { detectCrossPageIssues, detectPageIssues } from './detectors.js';
import { parseHtml } from './parser.js';

function html(body: string, head = ''): string {
  return `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;
}

function parse(body: string, head = '', url = 'https://acme.myshopify.com/products/hat'): ReturnType<typeof parseHtml> {
  return parseHtml(html(body, head), {
    requestedUrl: url,
    finalUrl: url,
    contentType: 'text/html',
    charset: 'utf-8',
    redirectChain: [],
    performance: { ttfbMs: 1, responseTimeMs: 2, pageSizeBytes: 1, htmlSizeBytes: 1, scriptCount: 0, stylesheetCount: 0 },
  });
}

function rules(extraction: ReturnType<typeof parseHtml>): string[] {
  return detectPageIssues(extraction).map((issue) => issue.rule);
}

describe('detectPageIssues', () => {
  it('detects missing metadata', () => {
    const extraction = parse('<p>This page has some words in it to count.</p>');
    const detected = rules(extraction);
    expect(detected).toEqual(
      expect.arrayContaining(['missing-title', 'missing-meta-description', 'missing-canonical', 'missing-h1']),
    );
  });

  it('flags long and short titles', () => {
    const long = parse('<p>x</p>', '<title>' + 'a'.repeat(70) + '</title>');
    expect(rules(long)).toContain('title-too-long');
    const short = parse('<p>x</p>', '<title>ab</title>');
    expect(rules(short)).toContain('title-too-short');
  });

  it('flags long and short meta descriptions', () => {
    const long = parse('<p>x</p>', '<meta name="description" content="' + 'a'.repeat(170) + '">');
    expect(rules(long)).toContain('meta-description-too-long');
    const short = parse('<p>x</p>', '<meta name="description" content="ab">');
    expect(rules(short)).toContain('meta-description-too-short');
  });

  it('flags multiple H1s and missing lang', () => {
    const multi = parse('<h1>One</h1><h1>Two</h1><p>some content</p>');
    expect(rules(multi)).toContain('multiple-h1');
    const noLang = parseHtml('<html><body><h1>Hi</h1></body></html>', {
      requestedUrl: 'https://acme.myshopify.com/x',
      finalUrl: 'https://acme.myshopify.com/x',
      contentType: null,
      charset: null,
      redirectChain: [],
      performance: { ttfbMs: 0, responseTimeMs: 0, pageSizeBytes: 0, htmlSizeBytes: 0, scriptCount: 0, stylesheetCount: 0 },
    });
    expect(rules(noLang)).toContain('missing-lang');
  });

  it('flags a conflicting canonical', () => {
    const conflicting = parse(
      '<p>content words</p>',
      '<title>Good title</title><link rel="canonical" href="https://acme.myshopify.com/other">',
    );
    expect(rules(conflicting)).toContain('conflicting-canonical');
  });

  it('ignores non-http and malformed canonicals', () => {
    const ftp = parse('<p>content</p>', '<link rel="canonical" href="ftp://acme.myshopify.com/x">');
    expect(rules(ftp)).not.toContain('conflicting-canonical');
    const malformed = parse('<p>content</p>', '<link rel="canonical" href="http://[">');
    expect(rules(malformed)).not.toContain('conflicting-canonical');
  });

  it('flags images without alt text', () => {
    const extraction = parse('<img src="/a.png"><img src="/b.png" alt="B">');
    expect(rules(extraction)).toContain('missing-alt-text');
  });

  it('flags thin content', () => {
    const extraction = parse('<p>tiny</p>', '<title>Title</title>');
    expect(rules(extraction)).toContain('thin-content');
  });

  it('flags redirect chains', () => {
    const extraction = parseHtml('<html><body>ok</body></html>', {
      requestedUrl: 'https://acme.myshopify.com/a',
      finalUrl: 'https://acme.myshopify.com/c',
      contentType: null,
      charset: null,
      redirectChain: ['https://acme.myshopify.com/a', 'https://acme.myshopify.com/b'],
      performance: { ttfbMs: 0, responseTimeMs: 0, pageSizeBytes: 0, htmlSizeBytes: 0, scriptCount: 0, stylesheetCount: 0 },
    });
    expect(rules(extraction)).toContain('redirect-chain');
  });

  it('short-circuits robots-blocked pages', () => {
    const extraction = { ...parse('<p>anything</p>'), robotsBlocked: true };
    expect(detectPageIssues(extraction)).toEqual([
      expect.objectContaining({ rule: 'robots-blocked', severity: 'HIGH' }),
    ]);
  });

  it('passes a clean page without false positives', () => {
    const extraction = parse(
      '<h1>One heading</h1>' +
        '<p>enough words here to exceed the thin content threshold comfortably.</p>'.repeat(6),
      [
        '<title>This is a sufficiently long product title</title>',
        '<meta name="description" content="A meta description that is long enough to be valid here.">',
        '<link rel="canonical" href="https://acme.myshopify.com/products/hat">',
      ].join(''),
    );
    expect(rules(extraction)).toEqual([]);
  });
});

describe('detectCrossPageIssues', () => {
  it('flags duplicate titles and descriptions', () => {
    const issues = detectCrossPageIssues({
      pages: [
        { url: 'https://a.com/1', title: 'Same', metaDescription: 'Dup' },
        { url: 'https://a.com/2', title: 'Same', metaDescription: 'Dup' },
        { url: 'https://a.com/3', title: 'Unique', metaDescription: 'Only here' },
      ],
      linkStatuses: [],
    });
    const dupTitles = issues.filter((i) => i.rule === 'duplicate-title');
    const dupDescriptions = issues.filter((i) => i.rule === 'duplicate-meta-description');
    expect(dupTitles).toHaveLength(1);
    expect(dupTitles[0]?.evidence).toBe('same');
    expect(dupDescriptions).toHaveLength(1);
  });

  it('flags broken links with non-2xx statuses', () => {
    const issues = detectCrossPageIssues({
      pages: [],
      linkStatuses: [
        { from: 'https://a.com/1', href: 'https://a.com/gone', statusCode: 404 },
        { from: 'https://a.com/1', href: 'https://a.com/ok', statusCode: 200 },
        { from: 'https://a.com/2', href: 'https://a.com/down', statusCode: 500 },
        { from: 'https://a.com/3', href: 'https://a.com/unchecked', statusCode: null },
      ],
    });
    const broken = issues.filter((i) => i.rule === 'broken-link');
    expect(broken).toHaveLength(2);
  });
});

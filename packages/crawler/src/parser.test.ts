import { describe, expect, it } from 'vitest';
import { parseHtml, type ParseContext } from './parser.js';

const PERFORMANCE = {
  ttfbMs: 40,
  responseTimeMs: 80,
  pageSizeBytes: 500,
  htmlSizeBytes: 500,
  scriptCount: 2,
  stylesheetCount: 1,
};

function context(overrides: Partial<ParseContext> = {}): ParseContext {
  return {
    requestedUrl: 'https://acme.myshopify.com/products/hat',
    finalUrl: 'https://acme.myshopify.com/products/hat',
    contentType: 'text/html',
    charset: 'utf-8',
    redirectChain: [],
    performance: PERFORMANCE,
    ...overrides,
  };
}

describe('parseHtml', () => {
  it('extracts metadata, links, images, content and performance', () => {
    const html = `
      <!doctype html>
      <html lang="en">
        <head>
          <title>   Hats for All  </title>
          <meta name="description" content="Quality hats.">
          <meta name="robots" content="index,follow">
          <meta name="theme-color" content="#ff0000">
          <meta property="og:title" content="Hats for All">
          <meta name="twitter:card" content="summary">
          <link rel="canonical" href="/products/hat">
          <link rel="icon" href="/favicon.ico">
          <link rel="stylesheet" href="/theme.css">
        </head>
        <body>
          <h1>Hats for All</h1>
          <p>We sell <strong>many</strong> hats.</p>
          <a href="/collections/all">Browse</a>
          <a href="https://evil.example.com/x" rel="nofollow">Evil</a>
          <a href="/image-item"><img src="/hat.png"></a>
          <img src="/logo.png">
          <img src="/banner.png" alt="Banner">
          <script>var x = 1;</script>
          <script type="application/ld+json">{"@type":"Product","name":"Hat"}</script>
        </body>
      </html>`;

    const extraction = parseHtml(html, context());
    expect(extraction.title).toBe('Hats for All');
    expect(extraction.metaDescription).toBe('Quality hats.');
    expect(extraction.metaRobots).toBe('index,follow');
    expect(extraction.canonicalUrl).toBe('/products/hat');
    expect(extraction.lang).toBe('en');
    expect(extraction.favicon).toBe('/favicon.ico');
    expect(extraction.themeColor).toBe('#ff0000');
    expect(extraction.ogTags).toEqual({ 'og:title': 'Hats for All' });
    expect(extraction.twitterTags).toEqual({ 'twitter:card': 'summary' });
    expect(extraction.h1).toEqual(['Hats for All']);
    expect(extraction.wordCount).toBeGreaterThan(0);
    expect(extraction.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(extraction.performance).toEqual(PERFORMANCE);

    expect(extraction.links).toHaveLength(3);
    expect(extraction.links[0]?.href).toBe('https://acme.myshopify.com/collections/all');
    expect(extraction.links[0]?.isInternal).toBe(true);
    expect(extraction.links[1]?.isInternal).toBe(false);
    expect(extraction.links[1]?.rel).toBe('nofollow');
    expect(extraction.links[2]?.isImage).toBe(true);

    expect(extraction.images).toHaveLength(3);
    expect(extraction.images[0]?.alt).toBeNull();
    expect(extraction.images[2]?.alt).toBe('Banner');
  });

  it('extracts structured data formats', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
      <script type="application/ld+json">not json</script>
      <div itemscope itemtype="https://schema.org/Product"></div>
      <div typeof="foaf:Person"></div>
    `;
    const extraction = parseHtml(html, context());
    expect(extraction.structuredData).toHaveLength(4);
    const jsonld = extraction.structuredData.filter((block) => block.format === 'jsonld');
    expect(jsonld[0]?.schemaType).toBe('Organization');
    expect(jsonld[0]?.valid).toBe(true);
    expect(jsonld[1]?.valid).toBe(false);
    expect(jsonld[1]?.schemaType).toBeNull();
    const microdata = extraction.structuredData.find((block) => block.format === 'microdata');
    expect(microdata?.schemaType).toBe('Product');
    const rdfa = extraction.structuredData.find((block) => block.format === 'rdfa');
    expect(rdfa?.schemaType).toBe('Person');
  });

  it('does not collect nested microdata/rdfa items as top-level blocks', () => {
    const html = `
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Hat</span>
        <div itemscope itemtype="https://schema.org/Offer">x</div>
      </div>
      <div typeof="schema:Product"><span typeof="schema:Review">y</span></div>
    `;
    const extraction = parseHtml(html, context());
    const topLevelMicrodata = extraction.structuredData.filter((b) => b.format === 'microdata');
    const topLevelRdfa = extraction.structuredData.filter((b) => b.format === 'rdfa');
    expect(topLevelMicrodata).toHaveLength(1);
    expect(topLevelRdfa).toHaveLength(1);
  });

  it('handles empty and script-only pages', () => {
    const extraction = parseHtml('<html><body></body></html>', context());
    expect(extraction.title).toBeNull();
    expect(extraction.h1).toEqual([]);
    expect(extraction.wordCount).toBe(0);
    expect(extraction.links).toEqual([]);
    expect(extraction.images).toEqual([]);
  });

  it('excludes script and style text from word counts', () => {
    const html = '<body><p>two words here</p><script>junk junk junk</script><style>more more</style></body>';
    const extraction = parseHtml(html, context());
    expect(extraction.wordCount).toBe(3);
  });

  it('skips mailto/javascript links', () => {
    const html = '<a href="mailto:a@b.com">Mail</a><a href="javascript:void(0)">JS</a>';
    const extraction = parseHtml(html, context());
    expect(extraction.links).toEqual([]);
  });

  it('skips links and images with missing or malformed attributes', () => {
    const html = `
      <a>no href</a>
      <a href="http://[">malformed</a>
      <img alt="no source">
      <img src="javascript:void(0)">
    `;
    const extraction = parseHtml(html, context());
    expect(extraction.links).toEqual([]);
    expect(extraction.images).toEqual([]);
  });

  it('tolerates an unresolvable origin', () => {
    const html = '<a href="/products/a">A</a><img src="/b.png">';
    const extraction = parseHtml(html, context({ finalUrl: 'not a url' }));
    expect(extraction.links).toEqual([]);
    expect(extraction.images).toEqual([]);
  });

  it('handles empty structured data and unusual schema shapes', () => {
    const html = `
      <script type="application/ld+json"></script>
      <script type="application/ld+json">"hello"</script>
      <script type="application/ld+json">{"@type":["Thing","Product"]}</script>
      <div itemscope></div>
      <div typeof="::"></div>
    `;
    const extraction = parseHtml(html, context());
    const blocks = extraction.structuredData;
    expect(blocks).toHaveLength(4);
    expect(blocks.find((b) => b.format === 'microdata')?.schemaType).toBeNull();
    const rdfa = blocks.find((b) => b.format === 'rdfa');
    expect(rdfa?.schemaType).toBe('::');
    const withArrayType = blocks.find((b) => b.schemaType === 'Thing');
    expect(withArrayType?.schemaType).toBe('Thing');
  });
});

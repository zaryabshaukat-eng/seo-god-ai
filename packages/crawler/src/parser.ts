import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type {
  PageExtraction,
  PageImageData,
  PageLinkData,
  PagePerformance,
  StructuredDataBlock,
} from './types.js';

export interface ParseContext {
  requestedUrl: string;
  finalUrl: string;
  contentType: string | null;
  charset: string | null;
  redirectChain: string[];
  performance: PagePerformance;
}

/**
 * Parses fetched HTML into a structured {@link PageExtraction}: metadata,
 * content statistics, links, images and structured data (JSON-LD, Microdata,
 * RDFa). Pure string→object transformation; never touches the network.
 */
export function parseHtml(html: string, context: ParseContext): PageExtraction {
  const $ = cheerio.load(html);
  const origin = safeOrigin(context.finalUrl);

  const title = $('title').first().text().trim() || null;
  const metaDescription = metaContent($, 'meta[name="description"]') || null;
  const metaRobots = metaContent($, 'meta[name="robots"]') || null;
  const canonicalUrl = $('link[rel="canonical"]').attr('href') ?? null;
  const lang = $('html').attr('lang') ?? null;
  const favicon = firstAttr($, 'link[rel*="icon"]', 'href') ?? null;
  const themeColor = metaContent($, 'meta[name="theme-color"]') || null;

  const ogTags = collectMetaProps($, 'meta[property^="og:"]');
  const twitterTags = collectMetaProps($, 'meta[name^="twitter:"]');

  const h1 = $('h1')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((text) => text !== '');

  const visibleText = extractVisibleText($);
  const wordCount = countWords(visibleText);
  const contentHash = createHash('sha256').update(visibleText).digest('hex');

  const links = extractLinks($, origin);
  const images = extractImages($, origin);
  const structuredData = extractStructuredData($);

  const performance = {
    ...context.performance,
    scriptCount: $('script').length,
    stylesheetCount: $('link[rel="stylesheet"]').length,
  };

  return {
    url: context.requestedUrl,
    finalUrl: context.finalUrl,
    statusCode: 200,
    contentType: context.contentType,
    charset: context.charset,
    redirectChain: context.redirectChain,
    robotsBlocked: false,
    title,
    metaDescription,
    metaRobots,
    canonicalUrl,
    h1,
    lang,
    favicon,
    themeColor,
    ogTags,
    twitterTags,
    links,
    images,
    structuredData,
    wordCount,
    contentHash,
    performance,
  };
}

function metaContent($: cheerio.CheerioAPI, selector: string): string | undefined {
  return $(selector).attr('content')?.trim();
}

function firstAttr($: cheerio.CheerioAPI, selector: string, attr: string): string | undefined {
  const element = $(selector).first();
  return element.length > 0 ? element.attr(attr) : undefined;
}

function collectMetaProps($: cheerio.CheerioAPI, selector: string): Record<string, string> {
  const tags: Record<string, string> = {};
  $(selector).each((_, el) => {
    const $el = $(el);
    const key = $el.attr('property') ?? $el.attr('name');
    const content = $el.attr('content');
    if (key && content !== undefined) tags[key] = content.trim();
  });
  return tags;
}

function extractVisibleText($: cheerio.CheerioAPI): string {
  const clone = $.root().clone();
  clone.find('script,style,noscript,svg,template').remove();
  const text = clone.text();
  return text.replace(/\s+/g, ' ').trim();
}

function countWords(text: string): number {
  return text === '' ? 0 : text.split(' ').filter((word) => word !== '').length;
}

function extractLinks($: cheerio.CheerioAPI, origin: string | null): PageLinkData[] {
  const links: PageLinkData[] = [];
  $('a').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    if (href === undefined) return;
    const absolute = resolveUrl(href, origin);
    if (absolute === null) return;

    const anchorText = $el.text().replace(/\s+/g, ' ').trim() || null;
    const rel = $el.attr('rel')?.trim() || null;
    links.push({
      href: absolute,
      anchorText,
      rel,
      isInternal: origin !== null && absolute.startsWith(origin),
      isImage: $el.find('img').length > 0,
    });
  });
  return links;
}

function extractImages($: cheerio.CheerioAPI, origin: string | null): PageImageData[] {
  const images: PageImageData[] = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    if (src === undefined) return;
    const absolute = resolveUrl(src, origin);
    if (absolute === null) return;
    const alt = $(el).attr('alt')?.trim();
    images.push({ src: absolute, alt: alt || null });
  });
  return images;
}

function extractStructuredData($: cheerio.CheerioAPI): StructuredDataBlock[] {
  const blocks: StructuredDataBlock[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text === '') return;
    try {
      const raw = JSON.parse(text) as unknown;
      blocks.push({ format: 'jsonld', schemaType: schemaTypeOf(raw), valid: true, raw });
    } catch {
      blocks.push({ format: 'jsonld', schemaType: null, valid: false, raw: null });
    }
  });

  $('[itemscope]').each((_, el) => {
    const $el = $(el);
    if ($el.parents('[itemscope]').length > 0) return;
    const itemtype = $el.attr('itemtype') ?? null;
    blocks.push({
      format: 'microdata',
      schemaType: typeName(itemtype),
      valid: true,
      raw: attributesOf(el),
    });
  });

  $('[typeof]').each((_, el) => {
    const $el = $(el);
    if ($el.parents('[typeof]').length > 0) return;
    const type = $el.attr('typeof') ?? null;
    blocks.push({
      format: 'rdfa',
      schemaType: typeName(type),
      valid: true,
      raw: attributesOf(el),
    });
  });

  return blocks;
}

function schemaTypeOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    const value = firstOf(raw);
    return typeof value === 'object' && value !== null
      ? schemaTypeOf(value)
      : typeof value === 'string'
        ? value
        : null;
  }
  const record = raw as Record<string, unknown>;
  const type = record['@type'];
  return typeof type === 'string' ? type : firstOf(type) ?? null;
}

function firstOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string') return first;
    return firstOf(first);
  }
  return null;
}

function typeName(value: string | null): string | null {
  if (value === null) return null;
  const last = value.split(/[\s/:]/).filter(Boolean).at(-1);
  return last ?? value;
}

function attributesOf(node: { attributes: Array<{ name: string; value: string }> }): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attr of node.attributes) {
    attributes[attr.name] = attr.value;
  }
  return attributes;
}

function resolveUrl(href: string, origin: string | null): string | null {
  try {
    const url = new URL(href, origin ?? undefined);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

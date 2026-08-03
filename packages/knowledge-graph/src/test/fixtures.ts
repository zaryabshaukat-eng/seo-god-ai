import type { PageExtraction, PageImageData, PageLinkData, PageType, SeoIssue } from '@seogod/crawler';
import type { Recommendation } from '@seogod/seo-engine';
import type { GraphBuildInput, KeywordInput } from '../types/input.js';

export const STORE_ID = 'store-1';
export const CRAWL_JOB_ID = 'crawl-1';
export const ORIGIN = 'https://acme.example';

export const fixedClock = (): Date => new Date('2026-01-01T00:00:00.000Z');

export function linkData(overrides: Partial<PageLinkData> = {}): PageLinkData {
  return { href: `${ORIGIN}/p/1`, anchorText: 'one', rel: null, isInternal: true, isImage: false, ...overrides };
}

export function imageData(overrides: Partial<PageImageData> = {}): PageImageData {
  return { src: `${ORIGIN}/images/1.jpg`, alt: 'alt text', ...overrides };
}

export function extraction(overrides: Partial<PageExtraction> = {}): PageExtraction {
  return {
    url: `${ORIGIN}/p/1`,
    finalUrl: `${ORIGIN}/p/1`,
    statusCode: 200,
    contentType: 'text/html',
    charset: 'utf-8',
    redirectChain: [],
    robotsBlocked: false,
    title: 'Default title',
    metaDescription: 'Default meta description',
    metaRobots: 'index,follow',
    canonicalUrl: null,
    h1: ['Default H1'],
    lang: 'en',
    favicon: null,
    themeColor: null,
    ogTags: {},
    twitterTags: {},
    links: [],
    images: [],
    structuredData: [],
    wordCount: 400,
    contentHash: 'abc123',
    performance: {
      ttfbMs: 120,
      responseTimeMs: 200,
      pageSizeBytes: 50_000,
      htmlSizeBytes: 45_000,
      scriptCount: 3,
      stylesheetCount: 2,
    },
    ...overrides,
  };
}

export function issue(overrides: Partial<SeoIssue> = {}): SeoIssue {
  return {
    rule: 'missing-title',
    severity: 'HIGH',
    message: 'Page has no title',
    details: {},
    evidence: 'evidence text',
    ...overrides,
  };
}

export function page(overrides: Partial<{ url: string; type: PageType; depth: number; extraction: PageExtraction | null; issues: SeoIssue[] }> = {}): {
  url: string;
  type: PageType;
  depth: number;
  extraction: PageExtraction | null;
  issues: SeoIssue[];
} {
  return { url: `${ORIGIN}/p/1`, type: 'page', depth: 1, extraction: extraction(), issues: [], ...overrides };
}

export function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'recommendation-1',
    rule: 'missing-title',
    category: 'content',
    priority: 'HIGH',
    score: 88,
    impact: 'HIGH',
    effort: 'LOW',
    confidence: 0.85,
    title: 'Add a unique page title',
    description: 'Add unique titles to every page',
    rationale: 'Unique titles drive clicks',
    recommendedAction: 'Write a unique title',
    evidence: [],
    affectedUrls: [`${ORIGIN}/p/1`],
    pageCount: 1,
    occurrenceCount: 1,
    crawlJobId: CRAWL_JOB_ID,
    storeId: STORE_ID,
    aiContext: {
      rule: 'missing-title',
      category: 'content',
      priority: 'HIGH',
      score: 88,
      impact: 'HIGH',
      effort: 'LOW',
      summary: 's',
      recommendedAction: 'a',
      affectedUrls: [`${ORIGIN}/p/1`],
      evidenceValues: [],
      constraints: [],
    },
    ...overrides,
  };
}

export function keyword(overrides: Partial<KeywordInput> = {}): KeywordInput {
  return { text: 'acme widget', searchIntent: 'transactional', targetUrls: [], ...overrides };
}

export function buildInput(
  overrides: Partial<GraphBuildInput> = {},
): GraphBuildInput {
  return {
    storeId: STORE_ID,
    crawlJobId: CRAWL_JOB_ID,
    pages: [page()],
    recommendations: [recommendation()],
    keywords: [],
    entities: [],
    videos: [],
    agentRuns: [],
    source: 'crawl.completed',
    ...overrides,
  };
}

/** A representative store: home, collection, two products, article, orphan page. */
export function storePages() {
  return [
    page({
      url: `${ORIGIN}/`,
      type: 'homepage',
      extraction: extraction({
        url: `${ORIGIN}/`,
        title: 'ACME Home',
        h1: ['ACME'],
        links: [
          linkData({ href: `${ORIGIN}/collections/all`, anchorText: 'Shop' }),
          linkData({ href: `${ORIGIN}/products/1`, anchorText: 'Widget' }),
          linkData({ href: `${ORIGIN}/products/2`, anchorText: 'Gadget' }),
          linkData({ href: `${ORIGIN}/blog/hello`, anchorText: 'Blog' }),
          linkData({ href: 'https://external.example/buy', anchorText: 'External', isInternal: false }),
        ],
        images: [imageData({ src: `${ORIGIN}/images/hero.jpg`, alt: 'hero' })],
      }),
    }),
    page({
      url: `${ORIGIN}/collections/all`,
      type: 'collection',
      extraction: extraction({
        url: `${ORIGIN}/collections/all`,
        title: 'All products',
        links: [
          linkData({ href: `${ORIGIN}/products/1` }),
          linkData({ href: `${ORIGIN}/products/2` }),
        ],
      }),
    }),
    page({
      url: `${ORIGIN}/products/1`,
      type: 'product',
      extraction: extraction({
        url: `${ORIGIN}/products/1`,
        title: 'Acme Widget',
        h1: ['Acme Widget'],
        links: [linkData({ href: `${ORIGIN}/`, anchorText: 'Home' })],
        images: [imageData({ src: `${ORIGIN}/images/widget.jpg`, alt: 'widget' })],
        structuredData: [
          { format: 'jsonld', schemaType: 'Product', valid: true, raw: {} },
          { format: 'jsonld', schemaType: 'Broken', valid: false, raw: {} },
        ],
      }),
    }),
    page({
      url: `${ORIGIN}/products/2`,
      type: 'product',
      extraction: extraction({
        url: `${ORIGIN}/products/2`,
        title: 'Acme Gadget',
        h1: ['Acme Gadget'],
        links: [linkData({ href: `${ORIGIN}/`, anchorText: 'Home' })],
        images: [imageData({ src: `${ORIGIN}/images/gadget.jpg`, alt: 'gadget' })],
        structuredData: [{ format: 'jsonld', schemaType: 'Product', valid: true, raw: {} }],
      }),
    }),
    page({
      url: `${ORIGIN}/blog/hello`,
      type: 'article',
      extraction: extraction({
        url: `${ORIGIN}/blog/hello`,
        title: 'Hello world',
        links: [linkData({ href: `${ORIGIN}/products/1`, anchorText: 'Widget' })],
      }),
    }),
    page({
      url: `${ORIGIN}/about`,
      type: 'page',
      depth: 2,
      extraction: extraction({
        url: `${ORIGIN}/about`,
        title: 'About us',
        links: [],
      }),
    }),
  ];
}

export function storeRecommendations() {
  return [
    recommendation({
      id: 'recommendation-1',
      rule: 'missing-title',
      title: 'Add unique titles',
      score: 95,
      affectedUrls: [`${ORIGIN}/about`],
    }),
    recommendation({
      id: 'recommendation-2',
      rule: 'slow-pages',
      category: 'performance',
      title: 'Speed up pages',
      score: 70,
      priority: 'MEDIUM',
      impact: 'MEDIUM',
      affectedUrls: [`${ORIGIN}/products/1`, `${ORIGIN}/products/2`],
    }),
  ];
}

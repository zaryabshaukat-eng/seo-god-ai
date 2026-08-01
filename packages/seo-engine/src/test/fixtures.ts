import type {
  CrawlStatistics,
  PageExtraction,
  PagePerformance,
  SeoIssue,
} from '@seogod/crawler';
import type { EngineInput, EnginePageInput } from '../types.js';

export const STATISTICS: CrawlStatistics = {
  pagesCrawled: 3,
  pagesFailed: 0,
  pagesBlocked: 0,
  totalIssues: 2,
  brokenLinks: 0,
  averageResponseTimeMs: 500,
  totalBytes: 10000,
  durationMs: 2000,
};

export function perf(overrides: Partial<PagePerformance> = {}): PagePerformance {
  return {
    ttfbMs: 400,
    responseTimeMs: 600,
    pageSizeBytes: 10000,
    htmlSizeBytes: 10000,
    scriptCount: 5,
    stylesheetCount: 2,
    ...overrides,
  };
}

export function extraction(overrides: Partial<PageExtraction> = {}): PageExtraction {
  return {
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    statusCode: 200,
    contentType: 'text/html',
    charset: 'utf-8',
    redirectChain: [],
    robotsBlocked: false,
    title: 'Example',
    metaDescription: 'A description.',
    metaRobots: null,
    canonicalUrl: 'https://example.com/',
    h1: ['Example'],
    lang: 'en',
    favicon: null,
    themeColor: null,
    ogTags: {},
    twitterTags: {},
    links: [],
    images: [],
    structuredData: [],
    wordCount: 500,
    contentHash: 'hash',
    performance: perf(),
    ...overrides,
  };
}

export function page(overrides: Partial<EnginePageInput> = {}): EnginePageInput {
  return {
    url: 'https://example.com/',
    type: 'page',
    depth: 0,
    extraction: extraction(),
    issues: [],
    ...overrides,
  };
}

export function issue(overrides: Partial<SeoIssue> = {}): SeoIssue {
  return {
    rule: 'missing-title',
    severity: 'HIGH',
    message: 'Missing title',
    details: {},
    evidence: 'title missing',
    ...overrides,
  };
}

export function engineInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    crawlJobId: 'job-1',
    storeId: 'store-1',
    pages: [page()],
    statistics: STATISTICS,
    ...overrides,
  };
}

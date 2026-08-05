/**
 * Typed clients for the five Google APIs the package integrates:
 * Search Console (Search Analytics + Sitemaps), Google Analytics 4 Data,
 * PageSpeed Insights, Rich Results / URL Testing Tools and the Indexing
 * API. Each method maps a Google REST call to a stable domain model and
 * normalizes or throws on malformed responses.
 */

import { GoogleValidationError } from './errors.js';
import type { GoogleHttpClient } from './http-client.js';
import type {
  Ga4RunReportQuery,
  Ga4RunReportResponse,
  Ga4Row,
  GscSite,
  IndexingNotificationResponse,
  IndexingNotificationType,
  PageSpeedResult,
  PageSpeedStrategy,
  RichResultsItem,
  RichResultsRunTestResponse,
  RichResultsTestStatusResponse,
  SearchAnalyticsQuery,
  SearchAnalyticsResponse,
  SitemapEntry,
} from './types.js';

export const SEARCH_CONSOLE_BASE_URL = 'https://www.googleapis.com/webmasters/v3';
export const ANALYTICS_BASE_URL = 'https://analyticsdata.googleapis.com/v1beta';
export const PAGESPEED_BASE_URL = 'https://www.googleapis.com/pagespeedonline/v5';
export const RICH_RESULTS_BASE_URL = 'https://searchconsole.googleapis.com/v1';
export const INDEXING_BASE_URL = 'https://indexing.googleapis.com/v3';

// ---------------------------------------------------------------------------
// Search Console
// ---------------------------------------------------------------------------

export interface SearchConsoleSitemapSubmit {
  siteUrl: string;
  /** Feed path, e.g. `sitemap.xml` or `https://example.com/sitemap.xml`. */
  feedpath: string;
}

export class SearchConsoleClient {
  constructor(private readonly http: GoogleHttpClient) {}

  /** Lists every property the authenticated account can access. */
  async listSites(accessToken: string): Promise<GscSite[]> {
    const json = (await this.http.get('/sites', { accessToken })) as Record<string, unknown>;
    const entries = Array.isArray(json.siteEntry) ? json.siteEntry : [];
    return entries.map((entry: unknown) => {
      const site = entry as Record<string, unknown>;
      return {
        siteUrl: typeof site.siteUrl === 'string' ? site.siteUrl : '',
        permissionLevel: typeof site.permissionLevel === 'string' ? site.permissionLevel : '',
      };
    });
  }

  /** Runs a Search Analytics query for a property. */
  async searchAnalytics(
    accessToken: string,
    siteUrl: string,
    query: SearchAnalyticsQuery,
  ): Promise<SearchAnalyticsResponse> {
    if (!siteUrl) {
      throw new GoogleValidationError('siteUrl is required', { operation: 'searchAnalytics' });
    }
    if (!query.startDate || !query.endDate) {
      throw new GoogleValidationError('startDate and endDate are required', {
        operation: 'searchAnalytics',
        resource: siteUrl,
      });
    }
    const json = (await this.http.post(`/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      accessToken,
      json: {
        startDate: query.startDate,
        endDate: query.endDate,
        dimensions: query.dimensions ?? undefined,
        searchType: query.searchType ?? undefined,
        rowLimit: query.rowLimit ?? undefined,
        startRow: query.startRow ?? undefined,
      },
    })) as Record<string, unknown>;

    const rows = Array.isArray(json.rows) ? json.rows : [];
    return {
      rows: rows.map((row) => normalizeSearchAnalyticsRow(row)),
      totalClicks: asNumber(json.totalClicks),
      totalImpressions: asNumber(json.totalImpressions),
      totalCtr: asNumber(json.totalCtr),
      totalPosition: asNumber(json.totalPosition),
    };
  }

  /** Lists the sitemaps Google knows about for a property. */
  async listSitemaps(accessToken: string, siteUrl: string): Promise<SitemapEntry[]> {
    if (!siteUrl) {
      throw new GoogleValidationError('siteUrl is required', { operation: 'listSitemaps' });
    }
    const json = (await this.http.get(`/sites/${encodeURIComponent(siteUrl)}/sitemaps`, {
      accessToken,
    })) as Record<string, unknown>;
    const sitemaps = Array.isArray(json.sitemap) ? json.sitemap : [];
    return sitemaps.map((entry) => normalizeSitemap(entry));
  }

  /** Submits a sitemap feed for a property. Resolves once Google accepted it. */
  async submitSitemap(accessToken: string, input: SearchConsoleSitemapSubmit): Promise<void> {
    if (!input.siteUrl || !input.feedpath) {
      throw new GoogleValidationError('siteUrl and feedpath are required', {
        operation: 'submitSitemap',
        resource: input.siteUrl,
      });
    }
    await this.http.put(
      `/sites/${encodeURIComponent(input.siteUrl)}/sitemaps/${encodeURIComponent(input.feedpath)}`,
      { accessToken },
    );
  }
}

// ---------------------------------------------------------------------------
// Google Analytics 4
// ---------------------------------------------------------------------------

export class AnalyticsClient {
  constructor(private readonly http: GoogleHttpClient) {}

  /** Runs a GA4 report for a property (numeric id or `properties/…`). */
  async runReport(accessToken: string, propertyId: string, query: Ga4RunReportQuery): Promise<Ga4RunReportResponse> {
    if (!propertyId) {
      throw new GoogleValidationError('propertyId is required', { operation: 'runReport' });
    }
    if (!query.dateRanges?.length || query.metrics.length === 0) {
      throw new GoogleValidationError('at least one dateRange and metric are required', {
        operation: 'runReport',
        resource: propertyId,
      });
    }
    const json = (await this.http.post(`/properties/${encodeURIComponent(propertyId)}:runReport`, {
      accessToken,
      json: {
        dateRanges: query.dateRanges,
        dimensions: query.dimensions ?? undefined,
        metrics: query.metrics,
        limit: query.limit ?? undefined,
        offset: query.offset ?? undefined,
      },
    })) as Record<string, unknown>;

    const rows = Array.isArray(json.rows) ? json.rows : [];
    const dimensionHeaders = extractNames(json.dimensionHeaders);
    const metricHeaders = extractNames(json.metricHeaders);
    return {
      dimensionHeaders,
      metricHeaders,
      rows: rows.map((row) => normalizeGa4Row(row)),
      rowCount: typeof json.rowCount === 'number' ? json.rowCount : rows.length,
    };
  }
}

// ---------------------------------------------------------------------------
// PageSpeed Insights
// ---------------------------------------------------------------------------

export interface PageSpeedQuery {
  url: string;
  strategy?: PageSpeedStrategy;
  /** Lighthouse category ids to include; all four by default. */
  categories?: string[];
}

const DEFAULT_PAGESPEED_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

export class PageSpeedClient {
  constructor(private readonly http: GoogleHttpClient) {}

  /** Runs a Lighthouse audit of `url`. Public API (no OAuth needed). */
  async analyze(query: PageSpeedQuery, apiKey?: string): Promise<PageSpeedResult> {
    if (!query.url) {
      throw new GoogleValidationError('url is required', { operation: 'pagespeed.analyze' });
    }
    const strategy = query.strategy ?? 'mobile';
    const urlQuery: Record<string, string | string[]> = {
      url: query.url,
      category: query.categories ?? DEFAULT_PAGESPEED_CATEGORIES,
      strategy,
    };
    const json = (await this.http.get('/runPagespeed', { query: urlQuery, apiKey })) as Record<string, unknown>;
    return parsePageSpeedResult(json, query.url, strategy);
  }
}

// ---------------------------------------------------------------------------
// Rich Results / URL Testing Tools
// ---------------------------------------------------------------------------

export interface RichResultsRunTestInput {
  url: string;
  /** Request a full-page screenshot in the test result. Default false. */
  requestScreenshot?: boolean;
}

export class RichResultsClient {
  constructor(private readonly http: GoogleHttpClient) {}

  /** Starts a Rich Results test for `url`. The test completes asynchronously. */
  async runTest(input: RichResultsRunTestInput, apiKey?: string): Promise<RichResultsRunTestResponse> {
    if (!input.url) {
      throw new GoogleValidationError('url is required', { operation: 'richresults.runTest' });
    }
    const json = (await this.http.post('/urlTestingTools/htmlChecks:run', {
      apiKey,
      json: { url: input.url, requestScreenshot: input.requestScreenshot ?? undefined },
    })) as Record<string, unknown>;
    return {
      testId: typeof json.testId === 'string' ? json.testId : '',
      url: typeof json.url === 'string' ? json.url : input.url,
      status: typeof json.status === 'string' ? json.status : 'UNKNOWN',
    };
  }

  /** Polls the status of a previously started Rich Results test. */
  async getTestStatus(testId: string, apiKey?: string): Promise<RichResultsTestStatusResponse> {
    if (!testId) {
      throw new GoogleValidationError('testId is required', { operation: 'richresults.getTestStatus' });
    }
    const json = (await this.http.get(`/urlTestingTools/htmlChecks/${encodeURIComponent(testId)}`, {
      apiKey,
    })) as Record<string, unknown>;
    const result = (json.result ?? {}) as Record<string, unknown>;
    const items = Array.isArray(result.items) ? result.items.map(normalizeRichResultsItem) : [];
    return {
      testId: typeof json.testId === 'string' ? json.testId : testId,
      url: typeof json.url === 'string' ? json.url : '',
      status: typeof json.status === 'string' ? json.status : 'UNKNOWN',
      items,
    };
  }
}

// ---------------------------------------------------------------------------
// Indexing API
// ---------------------------------------------------------------------------

export class IndexingClient {
  constructor(private readonly http: GoogleHttpClient) {}

  /** Notifies Google that `url` was updated or deleted. */
  async notify(
    accessToken: string,
    url: string,
    type: IndexingNotificationType,
  ): Promise<IndexingNotificationResponse> {
    if (!url) {
      throw new GoogleValidationError('url is required', { operation: 'indexing.notify' });
    }
    const json = (await this.http.post('/urlNotifications:publish', {
      accessToken,
      json: { url, type },
    })) as Record<string, unknown>;
    return normalizeIndexingNotification(json);
  }

  /** Reads the current indexing status of `url`. */
  async getStatus(accessToken: string, url: string): Promise<IndexingNotificationResponse> {
    if (!url) {
      throw new GoogleValidationError('url is required', { operation: 'indexing.getStatus' });
    }
    const json = (await this.http.get('/urlNotifications/metadata', {
      accessToken,
      query: { url },
    })) as Record<string, unknown>;
    return normalizeIndexingNotification(json);
  }
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normalizeSearchAnalyticsRow(row: unknown): {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
} {
  const value = (row ?? {}) as Record<string, unknown>;
  return {
    keys: Array.isArray(value.keys) ? value.keys.map(String) : [],
    clicks: asNumber(value.clicks),
    impressions: asNumber(value.impressions),
    ctr: asNumber(value.ctr),
    position: asNumber(value.position),
  };
}

function normalizeSitemap(entry: unknown): SitemapEntry {
  const value = (entry ?? {}) as Record<string, unknown>;
  return {
    path: typeof value.path === 'string' ? value.path : '',
    lastSubmitted: optionalString(value.lastSubmitted),
    lastDownloaded: optionalString(value.lastDownloaded),
    isPending: value.isPending === true,
    isSitemapsIndex: value.isSitemapsIndex === true,
    type: optionalString(value.type),
    errors: optionalString(value.errors),
    warnings: optionalString(value.warnings),
  };
}

function normalizeGa4Row(row: unknown): Ga4Row {
  const value = (row ?? {}) as Record<string, unknown>;
  const dimensions = Array.isArray(value.dimensionValues) ? value.dimensionValues : [];
  const metrics = Array.isArray(value.metricValues) ? value.metricValues : [];
  return {
    dimensionValues: dimensions.map((item) => stringValue(item, 'value')),
    metricValues: metrics.map((item) => stringValue(item, 'value')),
  };
}

function normalizeRichResultsItem(entry: unknown): RichResultsItem {
  const value = (entry ?? {}) as Record<string, unknown>;
  const subItems = Array.isArray(value.items) ? value.items : [];
  return {
    name: typeof value.name === 'string' ? value.name : '',
    items: subItems.map((item) => {
      const sub = (item ?? {}) as Record<string, unknown>;
      return {
        name: typeof sub.name === 'string' ? sub.name : '',
        text: typeof sub.text === 'string' ? sub.text : '',
        isPass: sub.isPass === true,
      };
    }),
    resultsCount: asNumber(value.resultsCount),
    passCount: asNumber(value.passCount),
  };
}

function normalizeIndexingNotification(json: Record<string, unknown>): IndexingNotificationResponse {
  const metadata = (json.urlNotificationMetadata ?? json) as Record<string, unknown>;
  return {
    url: typeof metadata.url === 'string' ? metadata.url : '',
    latestUpdate: normalizeIndexingEntry(metadata.latestUpdate),
    latestRemove: normalizeIndexingEntry(metadata.latestRemove),
  };
}

function normalizeIndexingEntry(entry: unknown): { url: string; notifyTime: string; type: IndexingNotificationType } | null {
  if (entry === null || entry === undefined) {
    return null;
  }
  const value = entry as Record<string, unknown>;
  return {
    url: typeof value.url === 'string' ? value.url : '',
    notifyTime: typeof value.notifyTime === 'string' ? value.notifyTime : '',
    type: value.type === 'URL_DELETED' ? 'URL_DELETED' : 'URL_UPDATED',
  };
}

function parsePageSpeedResult(raw: unknown, url: string, strategy: PageSpeedStrategy): PageSpeedResult {
  const root = (raw ?? {}) as Record<string, unknown>;
  const lighthouse = (root.lighthouseResult ?? {}) as Record<string, unknown>;
  const categories = (lighthouse.categories ?? {}) as Record<string, unknown>;
  const audits = (lighthouse.audits ?? {}) as Record<string, unknown>;

  const scores: Record<string, number> = {};
  for (const [key, category] of Object.entries(categories)) {
    const score = (category as Record<string, unknown>).score;
    if (typeof score === 'number') {
      scores[key] = score;
    }
  }

  const auditOf = (name: string): { score: number | null; displayValue: string } => {
    const audit = (audits[name] ?? {}) as Record<string, unknown>;
    return {
      score: typeof audit.score === 'number' ? audit.score : null,
      displayValue: typeof audit.displayValue === 'string' ? audit.displayValue : '',
    };
  };

  return {
    url,
    strategy,
    fetchedAt: typeof lighthouse.fetchTime === 'string' ? lighthouse.fetchTime : '',
    scores,
    metrics: {
      firstContentfulPaint: auditOf('first-contentful-paint'),
      largestContentfulPaint: auditOf('largest-contentful-paint'),
      totalBlockingTime: auditOf('total-blocking-time'),
      cumulativeLayoutShift: auditOf('cumulative-layout-shift'),
      speedIndex: auditOf('speed-index'),
      interactive: auditOf('interactive'),
    },
  };
}

function extractNames(headers: unknown): string[] {
  if (!Array.isArray(headers)) {
    return [];
  }
  return headers.map((header) => {
    const value = (header ?? {}) as Record<string, unknown>;
    return typeof value.name === 'string' ? value.name : '';
  });
}

function stringValue(item: unknown, key: string): string {
  const value = (item ?? {}) as Record<string, unknown>;
  return typeof value[key] === 'string' ? (value[key] as string) : '';
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

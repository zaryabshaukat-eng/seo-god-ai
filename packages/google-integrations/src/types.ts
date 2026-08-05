/**
 * Core domain models for the Google integrations package.
 *
 * Types mirror the wire shapes of the Google REST APIs that the package
 * talks to (Search Console, Analytics Data, PageSpeed Insights, Rich
 * Results / URL Testing Tools and the Indexing API), normalized into stable
 * interfaces so callers never touch raw JSON.
 */

/** Which Google product a credential, client or sync run targets. */
export type GoogleProvider = 'search-console' | 'analytics' | 'pagespeed' | 'rich-results' | 'indexing';

/** Raw response from the OAuth token endpoint. */
export interface OAuthTokenResult {
  accessToken: string;
  /** Present on the first authorization-code exchange (offline access). */
  refreshToken?: string;
  /** Lifetime of the access token in seconds, when the API reports it. */
  expiresIn?: number;
  /** Space-separated granted scope list. */
  scope: string;
  tokenType: string;
}

/** Profile data returned by the OpenID Connect userinfo endpoint. */
export interface GoogleUserInfo {
  /** Stable account id (`sub`). */
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
}

/** A persisted OAuth credential, keyed by `provider:account`. */
export interface StoredCredential {
  provider: GoogleProvider;
  /** Account identifier (the Google account email) the token belongs to. */
  account: string;
  accessToken: string;
  refreshToken?: string;
  /** Space-separated granted scope list. */
  scope: string;
  /** Epoch milliseconds at which the access token expires (0 = unknown). */
  expiresAt: number;
  tokenType: string;
  /** ISO timestamp of the last store/refresh. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Search Console
// ---------------------------------------------------------------------------

/** A property (site) the authenticated account can access. */
export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface SearchAnalyticsQuery {
  /** Inclusive `YYYY-MM-DD` start of the window. */
  startDate: string;
  /** Inclusive `YYYY-MM-DD` end of the window. */
  endDate: string;
  /** Dimension keys to group rows by (e.g. `query`, `page`, `date`). */
  dimensions?: string[];
  /** `web`, `image`, `video` or `news`. Defaults to `web`. */
  searchType?: string;
  /** Maximum number of rows to return. Default 1000. */
  rowLimit?: number;
  /** Zero-based offset for pagination. */
  startRow?: number;
}

export interface SearchAnalyticsRow {
  /** Values matching the requested dimensions, in the same order. */
  keys: string[];
  clicks: number;
  impressions: number;
  /** Fraction `0..1`. */
  ctr: number;
  /** Average position (1 = top). */
  position: number;
}

export interface SearchAnalyticsResponse {
  rows: SearchAnalyticsRow[];
  totalClicks: number;
  totalImpressions: number;
  totalCtr: number;
  totalPosition: number;
}

export interface SitemapEntry {
  path: string;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  isPending: boolean;
  isSitemapsIndex: boolean;
  type: string | null;
  errors: string | null;
  warnings: string | null;
}

// ---------------------------------------------------------------------------
// Google Analytics 4
// ---------------------------------------------------------------------------

export interface Ga4DateRange {
  /** Inclusive `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive `YYYY-MM-DD`. */
  endDate: string;
}

export interface Ga4Metric {
  name: string;
}

export interface Ga4Dimension {
  name: string;
}

export interface Ga4RunReportQuery {
  dateRanges: Ga4DateRange[];
  metrics: Ga4Metric[];
  dimensions?: Ga4Dimension[];
  /** Number of rows to return (max 100000). */
  limit?: number;
  /** Zero-based row offset. */
  offset?: number;
}

export interface Ga4Row {
  dimensionValues: string[];
  metricValues: string[];
}

export interface Ga4RunReportResponse {
  dimensionHeaders: string[];
  metricHeaders: string[];
  rows: Ga4Row[];
  rowCount: number;
}

// ---------------------------------------------------------------------------
// PageSpeed Insights
// ---------------------------------------------------------------------------

export type PageSpeedStrategy = 'mobile' | 'desktop';

export interface PageSpeedAudit {
  score: number | null;
  displayValue: string;
}

export interface PageSpeedMetrics {
  firstContentfulPaint: PageSpeedAudit;
  largestContentfulPaint: PageSpeedAudit;
  totalBlockingTime: PageSpeedAudit;
  cumulativeLayoutShift: PageSpeedAudit;
  speedIndex: PageSpeedAudit;
  interactive: PageSpeedAudit;
}

export interface PageSpeedResult {
  url: string;
  strategy: PageSpeedStrategy;
  /** ISO timestamp reported by Lighthouse. */
  fetchedAt: string;
  /** Category scores `0..1`, keyed by Lighthouse category id. */
  scores: Record<string, number>;
  metrics: PageSpeedMetrics;
}

// ---------------------------------------------------------------------------
// Rich Results / URL Testing Tools
// ---------------------------------------------------------------------------

export interface RichResultsItem {
  name: string;
  items: Array<{ name: string; text: string; isPass: boolean }>;
  resultsCount: number;
  passCount: number;
}

export interface RichResultsRunTestResponse {
  testId: string;
  url: string;
  /** `TESTING` while the run is pending server-side. */
  status: string;
}

export interface RichResultsTestStatusResponse {
  testId: string;
  url: string;
  status: string;
  items: RichResultsItem[];
}

// ---------------------------------------------------------------------------
// Indexing API
// ---------------------------------------------------------------------------

export type IndexingNotificationType = 'URL_UPDATED' | 'URL_DELETED';

export interface IndexingNotificationResponse {
  url: string;
  latestUpdate: IndexingNotification | null;
  latestRemove: IndexingNotification | null;
}

export interface IndexingNotification {
  url: string;
  /** ISO timestamp of the notification. */
  notifyTime: string;
  type: IndexingNotificationType;
}

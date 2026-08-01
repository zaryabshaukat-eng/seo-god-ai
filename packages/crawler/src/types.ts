export type PageType =
  | 'homepage'
  | 'product'
  | 'collection'
  | 'blog'
  | 'article'
  | 'page'
  | 'policy'
  | 'search'
  | 'other';

export type IssueSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface UrlRecord {
  /** Normalized absolute URL. */
  url: string;
  /** Kind of page the URL points to. */
  type: PageType;
  /** Breadth-first depth from the seeds. */
  depth: number;
  /** Lower numbers are crawled first. */
  priority: number;
  /** Whether this URL was a crawl seed. */
  seed: boolean;
}

export interface PageLinkData {
  href: string;
  anchorText: string | null;
  rel: string | null;
  isInternal: boolean;
  isImage: boolean;
}

export interface PageImageData {
  src: string;
  alt: string | null;
}

export interface StructuredDataBlock {
  format: 'jsonld' | 'microdata' | 'rdfa';
  schemaType: string | null;
  valid: boolean;
  raw: unknown;
}

export interface PagePerformance {
  ttfbMs: number;
  responseTimeMs: number;
  pageSizeBytes: number;
  htmlSizeBytes: number;
  scriptCount: number;
  stylesheetCount: number;
}

export interface PageExtraction {
  url: string;
  finalUrl: string;
  statusCode: number;
  contentType: string | null;
  charset: string | null;
  redirectChain: string[];
  robotsBlocked: boolean;
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonicalUrl: string | null;
  h1: string[];
  lang: string | null;
  favicon: string | null;
  themeColor: string | null;
  ogTags: Record<string, string>;
  twitterTags: Record<string, string>;
  links: PageLinkData[];
  images: PageImageData[];
  structuredData: StructuredDataBlock[];
  wordCount: number;
  contentHash: string;
  performance: PagePerformance;
}

export interface SeoIssue {
  rule: string;
  severity: IssueSeverity;
  message: string;
  details: Record<string, unknown>;
  evidence: string;
}

export interface CrawlPageSnapshot {
  /** URL as queued (normalized seed). */
  url: string;
  type: PageType;
  depth: number;
  extraction: PageExtraction | null;
  issues: SeoIssue[];
}

export interface CrawlStatistics {
  pagesCrawled: number;
  pagesFailed: number;
  pagesBlocked: number;
  totalIssues: number;
  brokenLinks: number;
  averageResponseTimeMs: number;
  totalBytes: number;
  durationMs: number;
}

export interface CrawlResult {
  crawlJobId: string;
  storeId: string;
  status: 'COMPLETED' | 'FAILED';
  statistics: CrawlStatistics;
  error: string | null;
}

# Crawler

`@seogod/crawler` crawls a Shopify store, extracts SEO-relevant page data, runs
on-page and cross-page SEO checks, and persists the result to the datastore.
It is production-grade: robots.txt compliant, rate-limited, bounded, and safe
against runaway crawls.

## Architecture

```
CrawlOrchestrator          entry point; owns the CrawlJob lifecycle and events
  └─ CrawlScheduler        crawl loop: bounded worker pool + graceful drain
       ├─ UrlQueue         priority heap, dedupe, hard caps
       ├─ RateLimiter      min spacing between requests
       ├─ Fetcher          redirects, retries, timeout, body cap, charset decode
       ├─ RobotsStore      per-origin robots.txt fetch + cache
       ├─ parseHtml        cheerio → PageExtraction
       ├─ detectPageIssues on-page SEO rules
       ├─ detectCrossPageIssues  broken links, duplicate titles/descriptions
       ├─ CrawlStore       Prisma persistence
       └─ CrawlMetrics     Prometheus-compatible metrics
```

The `CrawlOrchestrator` is the only thing applications construct. It wires the
scheduler from a `PrismaClient`, a `Logger`, a `MetricsRegistry`, and an
optional outbox `EventBus`.

## Usage

```ts
import { CrawlOrchestrator } from '@seogod/crawler';

const orchestrator = new CrawlOrchestrator(
  { prisma, logger, metrics, eventBus },
  {
    userAgent: 'SeoGodBot (+https://seogod.ai/bot)',
    respectRobotsTxt: true,
    concurrency: 8,
    maxPages: 5000,
    maxDepth: 6,
    rateLimitMs: 200,
  },
);

const result = await orchestrator.crawl('store-1', ['https://acme.myshopify.com/']);
// { crawlJobId, storeId, status: 'COMPLETED' | 'FAILED', statistics, error }
```

A run always returns a `CrawlResult`:

- `COMPLETED` — statistics recorded, `crawl.completed` published.
- `FAILED` — the job is marked failed (e.g. no valid seed URLs), `crawl.failed`
  published.

Event publishing is best-effort: an outbox failure is logged but never fails
the crawl.

## Job lifecycle

`PENDING → RUNNING → COMPLETED | FAILED` on `CrawlJob`. Page snapshots are
upserted into `Page` keyed on `(crawlJobId, url)`, with links, structured
data, and issues in their own tables. See [Database](database.md).

## Safety properties

- **Robots.txt** — the crawler respects `Disallow`/`Allow` (longest path wins,
  ties favour Allow), `Crawl-Delay` (when `respectRobotsTxt`), and supports
  `*` and trailing `$` wildcards. A broken or missing robots file degrades to
  allow-all so crawls never stall.
- **Rate limiting** — `rateLimitMs` enforces minimum spacing between requests;
  `concurrency` bounds the worker pool.
- **Bounded crawl** — `maxPages` and `queueMaxSize` cap admitted URLs;
  `maxDepth` limits link expansion. Deduplication means each normalized URL is
  fetched at most once.
- **HTTP client** — manual redirect following with a hop limit, exponential
  backoff + `Retry-After` on transient failures, a hard response-size cap, and
  UTF-8 fallback decoding.
- **Link policy** — only crawlable, same-origin URLs are enqueued.

## SEO checks

On-page (`detectPageIssues`): missing/oversized title, missing or short meta
description, thin content, multiple/no H1, missing `lang`, no favicon,
non-HTTPS canonical, robots-blocked pages, and image `alt` handling.

Cross-page (`detectCrossPageIssues`): broken internal links, duplicate titles,
and duplicate meta descriptions across the crawl.

## Metrics

Counters render with a `_total` suffix in Prometheus exposition:
`seogod_pages_crawled_total`, `seogod_crawl_failures_total`,
`seogod_issues_detected_total`, plus `seogod_crawl_duration_seconds`,
`seogod_average_response_time`, and `seogod_crawler_queue_depth`.

## Configuration

| Env var                    | Default | Meaning                            |
| -------------------------- | ------- | ---------------------------------- |
| `CRAWLER_RESPECT_ROBOTS_TXT` | `true` | Respect `robots.txt`             |
| `CRAWLER_MAX_PAGES`        | `5000`  | Hard cap on crawled pages          |
| `CRAWLER_RATE_LIMIT_MS`    | `200`   | Minimum spacing between requests   |

## Events

- `crawl.completed` — `aggregateType: crawlJob`, payload `{ storeId, statistics }`.
- `crawl.failed` — payload `{ storeId, error }`.

## Testing

```bash
npm run test --workspace @seogod/crawler
npm run test:coverage --workspace @seogod/crawler
```

Tests use a fake Prisma client and a mock `fetch`, so no database or network is
required. Coverage thresholds (95%) are enforced for lines, branches,
functions, and statements.

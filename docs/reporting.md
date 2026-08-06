# Reporting

`@seogod/reports` turns platform history into actionable reports: executive
dashboards, SEO and KPI reports, historical trends, alert summaries and
scheduled report runs, exported as JSON, CSV or PDF.

The package is a pure computation layer. It never talks to Shopify, never
writes to a database and has no transport. All platform data flows in through
*structural* interfaces (`ReportSources`) so callers hand the engine their own
readers, and everything it produces — a `Report` — is plain data that an
application can persist, deliver or render as it sees fit.

## Architecture

```
ReportEngineService                    (facade: engine + metrics + scheduler + KPI tracking)
  ├─ engine.generate()                 ReportEngine
  │    ├─ collectSourceData()          sources.ts   → ReportSourceData
  │    ├─ template.buildSections()     templates.ts → typed ReportSection[]
  │    ├─ buildTrendSeries()           aggregation.ts → TrendSeries[]
  │    ├─ aggregateAlerts()            aggregation.ts
  │    ├─ aggregateKpis()              kpis.ts       → KpiSnapshot (with deltas)
  │    └─ render()                     csv.ts / pdf-renderer.ts
  ├─ kpiTracker.record()               KpiTracker   → latest per store + history
  ├─ scheduler.runDue()                ReportScheduler → cron-driven generation
  └─ metrics.*()                       ReportMetrics  → report_* counters/gauges
```

The engine and its renderers are pure: given the same sources and period they
produce the same report. `ReportEngineService` layers metrics, KPI persistence
and scheduling on top and is the single entry point for the API layer and
scheduled jobs.

## Sources

`ReportSources` is a structural contract, so upstream packages stay dev-only
dependencies. The engine reads four readers:

| Group      | Methods                                                              | Feeds |
| ---------- | -------------------------------------------------------------------- | ----- |
| `observability` | `listExecutions`, `listSnapshots`, `listAlerts`, `listChanges` | SEO score, execution success/rollback rates, alerts |
| `learning` | `analyzeOutcomes`, `getHistoricalOutcomes`, `summarizeFeedback`, `getSignals` | learned success rate, feedback net score |
| `decision` | `listPlans`, `getDecision`                                       | recommendation/opportunity sections |
| `google`   | `searchAnalytics` (`SearchConsoleClientLike`), `runReport` (`AnalyticsClientLike`), `tokenProvider` | clicks/impressions/CTR/position, sessions/users/pageviews |

Google access is optional and configured per source with a token provider and
site/property ids; search-analytics rows are normalized through
`fromSearchAnalyticsResponse` and GA4 through `fromGa4Report`, so headers can
be absent or columns missing and the engine still produces zero-filled series.

## Periods

Report periods are inclusive `YYYY-MM-DD` ranges. `periodFor` derives a period
from an end date and length (`days`), `daysIn` validates it, and
`previousPeriod` computes the same-length window immediately before it. All
date math is UTC. The engine rejects a period whose end precedes its start with
a `ReportValidationError`.

KPI deltas are computed against the previous period when `compare` is set (or an
explicit `previousPeriod` is given). A value whose previous period cannot be
computed is `null`, never a fabricated zero.

## Templates

Five report kinds exist (`ReportKind`):

| Kind                   | Sections                                                        |
| ---------------------- | --------------------------------------------------------------- |
| `executive-dashboard`  | summary KPIs, trends, alerts, recommendation highlights         |
| `seo`                  | overall score, score by dimension, top issues, broken links     |
| `kpi`                  | KPI grid, historical deltas, learning summary, top opportunities |
| `trends`               | per-series trend charts over the period                         |
| `alerts`               | alert list and daily alert histogram                            |

Templates are built with `getTemplate(kind)`; every template exposes
`buildSections(data, options)` so callers can reuse a section builder against
custom data. Trend sections fall back to a deterministic ordering of the known
series (SEO score, clicks, impressions, CTR, position, sessions, users, page
views, executions, alerts) and append unknown series sorted by label.

## KPIs and tracking

`aggregateKpis` computes 12 KPIs per period: SEO score; clicks, impressions,
CTR, avg position; sessions, users, page views; execution success rate,
rollback rate, alert count; and learned success rate. Each carries a `delta`
when a previous period exists, a `unit`, and `higherIsBetter`.

`KpiTracker` persists snapshots per store so applications can serve
`latest(storeId)` for dashboards and `history(storeId, key)` for charts. The
service records a snapshot automatically on `generateAndTrack` (and never for
scheduled runs, which are ephemeral).

## Rendering

`renderReportToCsv` flattens a report's sections and KPIs into CSV. `renderReportToPdf`
lays the same sections out as a paginated PDF (text, tables, bar charts, colors)
produced by `pdf-writer`, a dependency-free PDF 1.4 writer that tracks pages and
adds pages as content grows. Both renderers are pure functions of the `Report`;
render failures are wrapped in a `ReportRenderError`.

`ReportEngine.render()` accepts `json | pdf | csv` formats and attaches the
results to `report.rendered`. `ReportEngineService.render` additionally records
format, duration and byte-size metrics.

## Scheduling

`ReportScheduler` holds `ScheduledReportRecord`s (id, kind, cron expression,
format, recipients, enabled, storeId, last run) and runs the due subset of them
on demand via `runDue(now)` using an injected clock. Cron fields are validated
at `add()` time. The service's default handler generates the configured format
for the period ending "now" and invokes the optional `onScheduleRun` hook for
delivery or persistence.

## Metrics

`ReportMetrics` reports to the injected `@seogod/monitoring` registry (all
optional, no-op without one):

- `report_generated_<kind>_<storeId>` counter
- `report_failed_<kind>` counter
- `report_rendered_<format>`, `report_render_time_<format>` (histogram),
  `report_rendered_bytes_<format>` (histogram)

## Usage

```ts
import { ReportEngineService } from '@seogod/reports';
import { ObservabilityStore } from '@seogod/observability';
import { LearningEngineService, InMemoryLearningStore } from '@seogod/learning-engine';

const service = new ReportEngineService({
  sources: {
    observability: new ObservabilityStore(),          // structural reader
    learning: new LearningEngineService({ store: new InMemoryLearningStore() }),
    decision: decisionReader,
    google: { searchConsole, analytics, tokenProvider, siteUrl, propertyId },
  },
  onScheduleRun: async (definition, report) => {
    await deliver(report, definition.recipients);     // email, webhook, storage…
  },
});

// One-off executive dashboard for last week, rendered to all three formats.
const report = await service.generateAndTrack({
  kind: 'executive-dashboard',
  periodOptions: { days: 7 },
  compare: true,
  renderers: ['json', 'csv', 'pdf'],
});

// Scheduled report run — fires everything whose cron is due right now.
await service.runScheduled(new Date());
```

## Testing

```bash
npm run test --workspace @seogod/reports
npm run test:coverage --workspace @seogod/reports
```

The suite covers source collection (Search Console, GA4, structural readers),
period math, aggregation (trends, alerts, rule performance), all twelve KPIs
and their deltas, every template/section builder, CSV and PDF rendering
(including table truncation and pagination), the scheduler and the service
facade. Coverage thresholds (95%) are enforced for lines, branches, functions
and statements.

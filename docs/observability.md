# Observability Engine

`@seogod/observability` is the platform's observability layer. It consumes the
structured events produced by the execution engine, crawler and SEO analysis
pipeline and turns them into immutable history, execution records, metrics,
alerts, timelines, dashboard overviews and learning signals for the decision
engine.

The engine is **read-oriented and append-only**: it never mutates store data,
never writes to Shopify and never re-executes anything. It sits beside the
execution engine and records what actually happened so every change is
auditable and every decision can be measured.

## Position in the platform

```
execution-engine ── execution.* events ──┐
crawler         ── crawl.* events      ──┤
seo-engine      ── seo.analysis.completed ┼──▶ @seogod/observability ──▶ metrics / alerts / signals
ai-orchestrator ── validation.failed   ──┘
```

The engine has three input paths:

1. **`ExecutionSinkAdapter`** — implements the execution engine's `ExecutionSink`
   contract so `ExecutionService` records a full `ExecutionReport` directly
   (steps, diffs, rollbacks, metrics).
2. **`EventBusConsumer`** — subscribes to the outbox `EventBus`
   (`@seogod/events`) and rehydrates typed observability events from payloads.
3. **`ObservabilityService.handle()` / `recordReport()` / `recordAnalysis()`** —
   direct API for tests, CLI tools and code that does not use the bus.

## Architecture

```
ObservabilityService                 facade: handle(), recordReport(), dashboard API
  ├─ ObservabilityStore              storage contract (in-memory by default)
  │    ├─ executions                 upserted, newest-first, terminal-sticky
  │    ├─ changes                    immutable apply/revert history
  │    ├─ snapshots                  SEO score snapshots (deduped)
  │    ├─ alerts                     deterministic alert records
  │    └─ events                     immutable event log
  ├─ MetricsService                  per-status counts, rates, p95 durations
  ├─ AlertService                    failures, rollback/validation spikes, SEO regressions
  ├─ TimelineService                 history, SEO/execution/performance timelines
  ├─ DashboardService                overview aggregation
  ├─ LearningSignalService           per-rule attempts/success/impact signals
  └─ MetricsRegistry (optional)      counters, histograms, gauges
```

## Consumed events

| Event                       | Effect                                                            |
| --------------------------- | ----------------------------------------------------------------- |
| `execution.queued`          | creates a `QUEUED` record (first delivery wins)                   |
| `execution.started`         | moves the record to `EXECUTING`                                  |
| `execution.completed`       | moves the record to `COMPLETED`, records duration                |
| `execution.failed`          | moves to `FAILED`, stores the error, raises an alert             |
| `execution.cancelled`       | moves to `CANCELLED` with the reason                             |
| `execution.rollback_started`| sets the rollback id, re-enters `EXECUTING`                      |
| `execution.rollback_completed` | moves to `ROLLED_BACK` (wins over other terminal states)      |
| `execution.rollback_failed` | annotates the error/rollback id onto the existing terminal record |
| `execution.publisher_failed`| moves to `FAILED` (critical alert)                               |
| `execution.safety_violation`| moves to `FAILED` (critical alert)                               |
| `crawl.completed` / `crawl.failed` | increments crawler counters                            |
| `seo.analysis.completed`    | appends an SEO snapshot, may fire a regression alert             |
| `validation.failed`         | increments validation-failure counter, may fire a spike alert    |

Unknown types are ignored by the consumer and surfaced by `handle()` without
touching any store collection.

### Terminal statuses are sticky

`TERMINAL_STATUSES` = `COMPLETED | FAILED | CANCELLED | ROLLED_BACK`. A terminal
record is never regressed by a late or out-of-order event, and `ROLLED_BACK`
outranks the other terminal states, so a completed execution that is rolled back
later cannot be flipped back to `COMPLETED` by a stale delivery. A failed
rollback annotates `error`/`rollbackId` onto the existing record instead of
overwriting its status.

## Idempotency

Events, snapshots, changes and alerts carry **stable content-derived ids**
(`deterministicUuid` over the payload). At-least-once delivery from the outbox
never duplicates a stored event, an alert or a change; re-running the same
report/analysis is a no-op on the store.

## Alerts

| Type                 | Severity  | Condition                                                              |
| -------------------- | --------- | ---------------------------------------------------------------------- |
| `execution_failure`  | warning   | plain execution failure                                                |
| `execution_failure`  | critical  | retry count `>= criticalRetryCount`, publisher/rollback/safety failure |
| `rollback_spike`     | critical  | `>= rollbackSpikeThreshold` rollbacks in the window                    |
| `validation_spike`   | warning   | `>= validationSpikeThreshold` validation failures in the window        |
| `seo_regression`     | warning   | score drops `>= seoRegressionDelta` vs the previous snapshot           |

Spike detection reads the immutable event log within `rollbackSpikeWindowMs` /
`validationSpikeWindowMs` (defaults: 3 and 5 in a 1h window). The SEO
regression compares the two most recent snapshots for the store. All defaults
live in `DEFAULT_ALERT_OPTIONS` and can be overridden per service.

## Dashboard API

`ObservabilityService` exposes the read model for the dashboard:

- `getOverview(storeId?)` — execution counts, SEO score, derived aggregates.
- `getExecutionMetrics(storeId?)` — per-status counts, success/failure/rollback
  rates, average and p95 duration, validation/safety/rollback counts, crawl
  success rate, simulation count.
- `getHistory({ storeId?, limit? })` — executions, snapshots, changes, alerts
  and a wire-shaped event list.
- `getAlerts(storeId?, limit?)`, `getChanges(storeId?, limit?)`.
- `getSeoTimeline`, `getExecutionTimeline`, `getPerformanceTimeline`
  (`PerformanceTimelineOptions.bucketMs` defaults to 1h).
- `getLearningSignals(storeId?)` — per-rule signals projected with
  `toHistoricalOutcome()` into the decision engine's `HistoricalOutcome` shape
  (`rule`, `attempts`, `successes`, `averageImpact`).

## Metrics registry

When a `MetricsRegistry` (`@seogod/monitoring`) is passed via options, the
engine reports counters (`execution_<status>_total`, `crawl_completed_total`,
`crawl_failed_total`, `validation_failed_total`, `alert_generated_total`),
histograms (`execution_duration_milliseconds`) and gauges
(`seo_overall_score_<storeId>`). Without a registry every path degrades
gracefully; `metricsSnapshot()` returns `null`.

## Usage

```ts
import { ObservabilityService, EventBusConsumer, InMemoryObservabilityStore } from '@seogod/observability';

const store = new InMemoryObservabilityStore();
const service = new ObservabilityService(store);   // options: now, alert, metrics

// from the event bus
new EventBusConsumer(bus, service).attach();

// or directly
await service.handle({ type: 'execution.completed', executionId: 'e1', storeId: 's1', duration: 120 });
await service.recordReport(report);
await service.recordAnalysis({ storeId: 's1', overallScore: 88, reference: 'AFTER' });

const overview = await service.getOverview('s1');
const signals = await service.getLearningSignals('s1');
```

The default store is in-memory. The `ObservabilityStore` interface is small and
append-only, so a durable implementation (Postgres/Prisma) can be dropped in
without touching the services.

## Testing

```bash
npm run test --workspace @seogod/observability
npm run test:coverage --workspace @seogod/observability
```

Coverage thresholds (95%) are enforced for lines, branches, functions and
statements. The suite covers the store (dedupe, filters, reset), every service,
both consumers (with a stub bus and a null-safety sink), the facade
integration paths, idempotency and sticky-terminal semantics.

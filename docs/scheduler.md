# Scheduler

`@seogod/scheduler` runs recurring and one-shot platform work — store crawls,
SEO analysis, and execution jobs — on a cron or timestamp schedule. It is the
automation backbone behind "set it and forget it" SEO: jobs are persisted,
picked up in priority order, run through registered handlers with retries,
timeouts and a distributed lock, and every attempt is recorded as an immutable
`JobRun`.

The scheduler never implements the work itself. A `JobHandler` is the only
integration point a caller provides, so crawls, analysis and execution stay in
their own packages while the scheduler owns *when* and *safely*.

## Architecture

```
AutonomousScheduler
  ├─ schedule()/update()/cancel()/delete()    job lifecycle
  ├─ runDueJobs()                             one tick: due → priority queue
  │     ├─ PriorityQueue                      min-heap, priority then fire time
  │     ├─ MemoryDistributedLock              one attempt per job per tick
  │     ├─ JobHandlerRegistry.execute()       caller-owned work (crawl/analysis/execution)
  │     ├─ retries                            exponential backoff on next tick
  │     └─ EventBusPublisher (optional)       outbox lifecycle events
  ├─ runNow(id)                               force an attempt outside the schedule
  ├─ start()/stop()                           periodic polling (setInterval)
  └─ SchedulerMetrics                         counters, gauges, duration histogram
```

## Scheduling

- Jobs are **recurring** (`cron`) or **one-shot** (`runsAt`) — exactly one of
  the two. `cron` accepts the standard 5-field form plus an optional leading
  seconds field, `*`/`?`, single values, ranges, steps (`*`/5, `10-30/5`),
  lists, and `JAN`..`DEC` / `SUN`..`SAT` names.
- Day-of-month / day-of-week follow the Vixie-cron rule: when both are
  restricted the date matches if **either** matches; when only one is
  restricted that one is authoritative.
- Expressions evaluate in the scheduler's local timezone. `CronExpression`
  exposes `seconds`, `minutes`, `hours`, `daysOfMonth`, `months` and
  `daysOfWeek` and computes the next fire time strictly after a date via
  `nextAfter()`; schedules that can never fire (e.g. Feb 31) return `null`.
- `nextRunAt` mirrors the next computed fire time on the persisted job so the
  repository selects due jobs without re-evaluating cron.

## Usage

```ts
import { AutonomousScheduler, crawlJobHandler, MemoryJobRepository, MemoryDistributedLock } from '@seogod/scheduler';
import { createLogger } from '@seogod/logging';

const scheduler = new AutonomousScheduler({
  repository: new MemoryJobRepository(),      // or a Prisma-backed JobRepository
  lock: new MemoryDistributedLock(),          // or Redis-based lock
  handlers: new JobHandlerRegistry(),         // optional; register later
  eventPublisher,                             // optional: outbox events
  metrics,                                    // optional
  logger,
});

scheduler.registerHandler(crawlJobHandler(async ({ payload }) => {
  // crawl payload.storeId / payload.seeds
  return { ok: true };
}));

await scheduler.schedule({
  kind: 'crawl',
  name: 'daily-store-crawl',
  storeId: 'store-1',
  cron: '0 3 * * *',
  priority: 'high',
  payload: { storeId: 'store-1', seeds: ['https://acme.example'] },
});

scheduler.start({ pollIntervalMs: 60_000 });  // periodic ticks
// ...or drive ticks manually:
await scheduler.runDueJobs();
```

## Lifecycle

- **Attempts** are lock-guarded (`scheduler:job:<id>`, owner = scheduler
  instance id). A due job whose lock is held by another instance is reported
  `skipped`, never double-run.
- On failure a job with `attempts <= maxRetries` is marked for retry on the
  next tick with exponential backoff (`retryBackoffMs * 2^(attempt-1)`, capped
  at 7 days); errors carrying `retryable: false` (e.g. validation) are never
  retried.
- Recurring jobs stay `pending` after success/failure and advance to the next
  cron occurrence; one-shot jobs reach a terminal `succeeded`/`failed` state.
- `runNow(id)` forces an attempt regardless of schedule (and refuses to double
  run a job already in flight).

## Persistence and locking

`JobRepository` isolates storage; the in-memory `MemoryJobRepository` ships for
tests and single-process deployments, and a Prisma implementation can back it
in production. The only query the runner needs is `nextDue(now, limit)`:
enabled, pending jobs whose `nextRunAt` has arrived, in priority order
(critical first, then fire time, then id).

`DistributedLock` prevents the same job from running twice across scheduler
instances. `MemoryDistributedLock` implements it with a lease that expires
after a TTL; a Redis-based implementation would satisfy the same interface.

## Events and metrics

| Event                      | When                              |
| -------------------------- | --------------------------------- |
| `scheduler.job.scheduled`  | job created                        |
| `scheduler.job.updated`    | job updated                        |
| `scheduler.job.cancelled`  | job cancelled                      |
| `scheduler.job.started`    | an attempt begins                  |
| `scheduler.job.succeeded`  | an attempt succeeds                |
| `scheduler.job.failed`     | an attempt fails (terminal)        |
| `scheduler.job.retrying`   | a failed attempt is rescheduled    |
| `scheduler.job.skipped`    | an attempt was lock-skipped        |

Events publish through `@seogod/events` as outbox-compatible messages;
publishing is best-effort and failures are logged, never raised.

Metrics: counters `scheduler_jobs_scheduled`, `_completed`, `_failed`,
`_retried`, `_skipped`, `scheduler_polls`, `scheduler_locks_contended`;
gauges `scheduler_queue_depth`, `scheduler_locks_held`; histogram
`scheduler_run_duration_ms`.

## Errors

All failures map to the `@seogod/core` error hierarchy:
`SchedulerValidationError` (bad input/schedule), `SchedulerConflictError`
(already running), `SchedulerNotFoundError` (missing job), `JobTimeoutError`
(per-attempt timeout), `LockAcquireError`, `MissingHandlerError`, and
`CronValidationError` (malformed cron expressions).

## Testing

```bash
npm run test --workspace @seogod/scheduler
npm run test:coverage --workspace @seogod/scheduler
```

The suite spans cron parsing/`nextAfter`, the priority queue, the repository,
locking, events, metrics, handlers, errors, and the `AutonomousScheduler`
facade (schedule/update/cancel/delete, priority ordering, retries with
backoff, lock skipping, timeouts, `runNow`, and start/stop under fake timers).
Coverage thresholds (95%) are enforced for lines, branches, functions, and
statements.

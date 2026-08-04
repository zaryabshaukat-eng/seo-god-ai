# Execution Engine

`@seogod/execution-engine` is the **only package allowed to write to Shopify**.
It takes an approved decision plan or agent actions and runs them through a
validated, safety-gated pipeline that publishes writes, computes diffs, records
metrics, emits events, and rolls back automatically when a step fails. Nothing
below this layer is permitted to mutate store data.

Every write is executed in a controlled mode, gated by the safety guard,
covered by an idempotency key, and reversible through a recorded rollback plan.
No execution happens without passing the validation pipeline.

## Modes

| Mode          | Writes | Step outcome | Purpose                             |
| ------------- | ------ | ------------ | ----------------------------------- |
| `DRY_RUN`     | no     | `SIMULATED`  | Preview expected-after states only  |
| `SIMULATION`  | no     | `SIMULATED`  | Simulated run against the pipeline  |
| `STAGING`     | yes    | `COMPLETED`  | Real writes against a staging store |
| `PRODUCTION`  | yes    | `COMPLETED`  | Real writes against a live store    |

Only `STAGING` and `PRODUCTION` count API calls and acquire the store lock;
`DRY_RUN`/`SIMULATION` run the full validation and diff pipeline without
touching the writer.

## Architecture

```
ExecutionService.execute(input)            high-level façade
  └─ ExecutionEngine.execute()
       ├─ ExecutionPlanner.plan()          topologically sorted steps + batches
       ├─ DryRunPlanner.plan()             precompute expected-after per step
       ├─ ApprovalGate.pendingApprovals()  approval required?
       │    ├─ return (PENDING) / enqueue via ExecutionWorker (QUEUED)
       │    └─ run inline
       ├─ SafetyGuard.assertCanExecute()   kill switch, active executions, mode
       ├─ StoreLock.acquire()              exclusive per-store lock (real modes)
       ├─ StepRunner.run() per step
       │    ├─ buildValidationContext()    idempotency keys, store lock, budget
       │    ├─ ValidationPipeline.validate() 10 checks in order
       │    ├─ OperationPublisher.publish()  rate-limited write, diff, timing
       │    └─ buildExecutionDiff()        before/after field-level diff
       ├─ BatchSaga / inline loop          on failure: auto-rollback in reverse
       ├─ RollbackEngine.rollbackStep()    restore_field / restore / revert
       ├─ buildMetrics() + saveMetrics()   apiCalls, rollbacks, duration
       ├─ metricsRegistry.increment()      execution.<MODE>.<STATUS>
       └─ emit(event)                      execution.* events
```

## Execution engine

`ExecutionEngine` orchestrates end-to-end runs. It is the only entry point that
turns an approved plan into writes, diffs, metrics and rollbacks.

- `execute(input, options)` — plans and submits. Returns immediately as
  `PENDING` when approval is required, `QUEUED` when `submit: 'queue'` is used
  (requires a worker), or runs inline and returns the finished execution.
- `approve(executionId, stepIds)` — marks steps approved so a pending execution
  can be resumed. Returns `null` for an unknown execution.
- `resume(executionId, shopDomain?)` — runs a previously-planned execution
  (after approval or from the queue). Throws if the execution does not exist.
- `cancel(executionId, reason?)` — cancels a `PENDING`/`QUEUED` execution.
- `emergencyStop(storeId?)` / `resumeFromStop(storeId?)` — forward to the
  safety guard's kill switch.
- `start()` / `stop()` — delegate to the optional `ExecutionWorker`.
- `executionRepository`, `safetyGuard`, `publisherOf` — public accessors.

### Lifecycle

1. **Plan** — steps are topologically sorted, idempotency keys assigned, and
   dry-run `expectedAfter` states are computed.
2. **Gate** — pending approvals short-circuit to `PENDING`; a configured worker
   can receive the execution via the queue.
3. **Validate & lock** — the safety guard rejects on kill-switch/conflict/mode,
   and the store lock is acquired in real modes.
4. **Run** — each step passes through the step runner; failures cancel the
   remaining steps.
5. **Finalize** — metrics, diffs, steps, and batches are persisted; a metric is
   incremented; the terminal event is emitted.
6. **Unlock** — the store lock is released in a `finally` block.

## Step runner and validation

`StepRunner.run` performs the safety assertion, captures the before-state,
builds a validation context, runs the pipeline, publishes through
`withTimeout`, and records `before`/`after`/`expectedAfter`/`apiCalls`/
`durationMs` and a computed diff. Step status becomes `COMPLETED` in real modes
and `SIMULATED` otherwise.

The `ValidationPipeline` runs checks in order; any failure fails the step and
throws `InvalidExecutionError`:

| Check                | Guards against                                        |
| -------------------- | ----------------------------------------------------- |
| `SchemaValidator`    | malformed action payloads per operation schema        |
| `PolicyValidator`    | out-of-policy stores/actions                          |
| `ApprovalValidator`  | unapproved mutating or sensitive steps                |
| `DependencyValidator`| unsatisfied step dependencies                         |
| `StateValidator`     | stale resource state (when `requireStateCheck`)       |
| `ConflictValidator`  | concurrent executions over the same resource          |
| `IdempotencyValidator` | repeated writes for the same idempotency key        |
| `RollbackValidator`  | missing/broken rollback plans for mutating steps      |
| `RateLimitValidator` | exceeding the per-store write budget                  |
| `PermissionValidator`| writer capability / operation capability mismatches   |

## Publisher and operations

`OperationPublisher` owns the operation registry and performs the actual
writes through a `ShopifyWriter`. Operations are declared with
`buildOperation`, `seoFieldOperation`, `buildFieldOperation`, and
`buildGenericUpdateOperation`:

- **Preview** — `expectedAfter(step)` computes the state that would result.
- **Apply** — `apply(step, writer, shopDomain, mode)` performs the write and
  returns the operation result with the after-state and API-call count.
- **Restore** — `restore(step, writer, shopDomain)` reverses the change.
- **Summarize** — a one-line human summary of the operation.

Two writers ship with the package: `ShopifyServiceWriter` forwards writes to
`@seogod/shopify` services; `MemoryShopifyWriter` records calls and is the
default in tests and demos. `RateLimiter.waitMs`/`consume` honor Shopify's
rolling per-store budget before writes are issued.

## Rollback

- `RollbackPlanner.planFromDecision(decision)` converts a decision-engine plan
  into execution rollback steps; `planForStep(step)` derives field-level
  restore steps from a step's recorded before-state.
- `RollbackEngine.rollbackStep(step, shopDomain)` executes the plan's steps in
  reverse, counting API calls; it reports `FAILED` with the error message when
  the publisher throws, and performs no writes in dry-run mode.
- On a step failure the engine rolls back the executed steps in reverse order,
  records a `RollbackRecord` per step, marks remaining steps `CANCELLED`, and
  sets the execution to `ROLLED_BACK`.

## Queue and workers

- `InMemoryQueueStore` — priority-ordered queue with delay, max-attempts,
  backoff, dead-lettering, and cancellation.
- `WorkerLoop` — claims one entry, runs the handler, and applies the retry
  policy on failure.
- `WorkerPool` — a bounded pool of loops with a concurrency cap; `pump()` and
  `waitForIdle()` run deterministically against a started pool.
- `ExecutionWorker` — drains `executionId` payloads through a pool; the engine
  submits queued executions here with `submit: 'queue'`.

## Repositories and monitoring

- `InMemoryExecutionRepository` (default) stores executions, steps, batches,
  diffs, rollback records, metrics, and history.
- `ExecutionService` is the high-level façade: it wires an engine from
  defaults and forwards `execute`, `approve`, `resume`, `cancel`, `report`,
  `getExecution`, and `listExecutions`.
- `ExecutionMonitor` reduces execution events into a status view; sinks
  (`InMemorySink`, `EventBusSink`) publish `execution.*` events. Metrics
  counters follow the `execution.<MODE>.<STATUS>` convention.

## Usage

```ts
import { ExecutionService, normalizeSafetyConfig } from '@seogod/execution-engine';

const service = new ExecutionService({
  config: normalizeSafetyConfig({ requireApproval: true }),
});

const execution = await service.execute({
  storeId: 's1',
  mode: 'DRY_RUN',                       // preview first, no writes
  actions: [
    { actionType: 'update_title', resourceType: 'product', resourceId: 'p1', payload: { title: 'New Title' } },
  ],
});

// execution.status === 'PENDING' until approved
await service.approve(execution.id, execution.steps.map((s) => s.id));
const resumed = await service.resume(execution.id, 'shop.example.com');
// resumed.status === 'COMPLETED', steps SIMULATED/COMPLETED
```

For a real write, switch `mode` to `STAGING` or `PRODUCTION`; the engine
handles validation, rate limiting, diffs, metrics, and rollback automatically.

## Testing

```bash
npm run test --workspace @seogod/execution-engine
npm run test:coverage --workspace @seogod/execution-engine
```

The suite covers the engine lifecycle (execute/approve/resume/cancel, queue
submission, safety rejection, rate-limited publish, rollback paths), every
operation, all ten validation checks, the step runner, planner, rollback
planner/engine, dry-run planner, queue/worker primitives, repository, diffs,
monitoring, and the service façade. Coverage thresholds (95%) are enforced for
lines, branches, functions, and statements.

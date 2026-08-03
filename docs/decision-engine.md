# Decision Engine

`@seogod/decision-engine` turns SEO recommendations into **executable, approved,
rollback-ready plans**. It is the last deterministic layer before any change
touches a live store: nothing is invented by an LLM at plan time, and nothing
executes without a safety review.

The pipeline is fully reproducible. Every id is derived from stable business
keys, every ranking and dependency is tie-broken deterministically, and a plan
can be re-generated from its `Decision` record and compared byte-for-byte.

## Architecture

```
DecisionEngineInput (store + recommendations + settings + flags)
  └─ Prioritizer.prioritize()          deterministic rank + scores
  └─ DecisionModel.create()            immutable, stable-id Decision
      └─ ExecutionPlanner.createTasks()  rule → action map, dedup by URL
      └─ ConflictDetector.detect()       duplicates / overwrites / exclusive
      └─ ExecutionPlanner.assemble()     ordering, batching, rollback plans
      └─ SafetyEngine.assess()           risk level + factors
      └─ ApprovalEngine.review()         policy → APPROVED / REJECTED / AWAITING
  → ExecutionPlan (tasks, batches, dependencies, approval request)
  └─ PlanExecutor (adapter)             executeTask() / executeRollback()
  └─ DecisionEngineService              orchestrates the whole lifecycle
```

The service pipeline in `DecisionEngineService`:

```
createDecision(input)  prioritize → persist → decision.created event
planDecision(id)       plan → assess → review → persist → plan.approved/rejected
approvePlan(id, by)    stamp approval → execution may proceed
rejectPlan(id, by)     stamp rejection → decision rejected
executePlan(id, exec)  ordered task execution → result per task
executeRollback(id, o) undo executed tasks → rollback record per task
```

## Determinism

- **Stable ids** — decisions, plans, tasks, batches, and approval requests get
  deterministic UUIDs (UUIDv5) from business keys:
  `decision = uuid5('decision', storeId + source + sortedRecIds)`,
  `task = taskIdFor(decisionId, recId, resourceId)`,
  `approval = uuid5('approval-request', planId + '\u0000' + policy)`.
  Re-running a job produces the same ids; nothing is random or timestamped.
- **Stable order** — prioritization sorts by score, then ties break on
  deterministic keys; the dependency graph is Kahn-ordered with a sorted ready
  set; batches slice tasks in a fixed order; conflict reports sort every kind
  by `kind` then `involved` ids.
- **Deterministic policies** — the ordered approval-rule list and
  execution-policy rules are evaluated first-match-wins, so the same input
  always yields the same verdict.

## Usage

```ts
import { DecisionEngineService, PrismaDecisionRepository } from '@seogod/decision-engine';
import { createClient } from '@seogod/database'; // or your PrismaClient

const service = new DecisionEngineService({
  repository: new PrismaDecisionRepository(prisma),
  eventBus,   // optional: publishes outbox events
  metrics,    // optional
  logger,     // optional
});

// 1. Create a decision from prioritized recommendations
const { decision } = await service.createDecision(input);

// 2. Plan it into ordered, batched, risk-assessed tasks
const { plan } = await service.planDecision(decision.id, {
  // capture current values so rollbacks can restore them
  beforeValues: { [taskId]: { title: 'Current title' } },
});

// 3. Approve (auto-approved low-risk plans need no human step)
const { plan: approved } = await service.approvePlan(plan.id, 'human@store.com');

// 4. Execute with a platform adapter
const executor = {
  async executeTask(task) { /* apply task.payload via Shopify Admin API */ },
  async executeRollback(plan) { /* undo plan.steps */ },
};
const { plan: finished, results } = await service.executePlan(approved.id, executor);

// 5. Roll back when something goes wrong
const { plan: rolledBack, records } = await service.executeRollback(finished.id, {
  reason: 'store owner requested',
});
```

## Planning

`ExecutionPlanner` converts recommendations into atomic `ExecutionTask`s:

- Each unique affected URL becomes one task; duplicates are deduped.
- Rules map to actions via `DEFAULT_RULE_ACTION_MAP` (overridable), e.g.
  `missing-title → update_title`, `remove-duplicate-content → delete_page`.
- Mutating tasks carry a `RollbackPlan` generated from captured `beforeValues`
  (field restore, value restore, or a revert step). Destructive actions
  (`delete_page`, `remove_*`) never get an automatic restore.
- Same-resource tasks are ordered sequentially by priority; `rulePrerequisites`
  add explicit cross-rule dependencies.
- A `Batcher` groups tasks by resource type and action type into API-friendly
  batches (max batch size from store settings), and
  `maxChangesPerResource` caps churn per resource.
- The assembled `ExecutionPlan` carries `orderedTaskIds`, `batches`,
  `dependencies`, estimated duration/effort/impact, and a risk level.

`ConflictDetector` guards the plan: duplicate actions on the same resource,
tasks overwriting shared content fields, mutually exclusive rules, and tasks
derived from a stale snapshot are flagged; conflicting tasks are excluded from
the plan (the highest-priority survivor wins).

## Safety, approval, and execution

`SafetyEngine` computes risk factors (destructive ratio/severity, business
value, historical failure rate, rollback availability, task count) and a
`LOW | MEDIUM | HIGH` level. `ApprovalEngine` then resolves a policy:

| Risk / setting        | Policy                    |
| --------------------- | ------------------------- |
| LOW + auto mode       | `AUTO_APPROVE` (no human) |
| MEDIUM or HIGH        | `REQUIRE_APPROVAL`        |
| HIGH, no rollback, block flag | `DENY`              |
| review mode           | `REQUIRE_APPROVAL` (or `DENY` for HIGH) |

A plan only executes when it is `APPROVED`; execution is strictly ordered by
`orderedTaskIds`, and each task produces an `ExecutionResult` persisted onto
the task. Failures flip the plan to `FAILED`; a completed rollback marks the
plan (or a single task) `ROLLED_BACK`.

## Persistence

The `DecisionRepository` interface isolates storage; PostgreSQL via Prisma
(`PrismaDecisionRepository`) is the default. Records:

- `Decision` — the input snapshot + prioritized recommendations + summary.
- `ExecutionPlan` — batches, ordering, dependencies, approval request id.
- `ExecutionTask` — payload, status, rollback plan, execution result.
- `PlanApprovalRequest` — policy, decider, timestamps.
- `RollbackRecord` — one per rollback with status, steps, error.

`toStoredJson` JSON-safe-serializes domain payloads into JSONB columns; the
in-memory `InMemoryDecisionRepository` is used across the test suite.

## Events and metrics

| Event                 | When                                |
| --------------------- | ----------------------------------- |
| `decision.created`    | decision persisted                  |
| `plan.approved`       | plan auto-approved or approved      |
| `plan.rejected`       | plan rejected                       |
| `execution.started`   | execution begins                    |
| `execution.completed` | all tasks finished                  |
| `execution.failed`    | an executor error aborted execution |
| `rollback.completed`  | a rollback finished                 |

Counters: `decision_count`, `execution_plan_count`, `approval_count`,
`rollback_count`; histograms: `average_plan_time`, `decision_duration`.

## Errors

All service failures map to the `@seogod/core` error hierarchy:
`ValidationError` (bad input), `ConflictError` (wrong plan/task state),
`NotFoundError` (missing records), `ConfigurationError` (missing executor).

## Testing

```bash
npm run test --workspace @seogod/decision-engine
npm run test:coverage --workspace @seogod/decision-engine
```

The suite spans per-module unit tests, `src/integration.test.ts` (the full
create → plan → approve → execute → rollback pipeline), and
`src/performance.test.ts` (1,200 recommendations plan in under 10s with
byte-identical batch/order output). Coverage thresholds (95%) are enforced for
lines, branches, functions, and statements.

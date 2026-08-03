# AI Orchestrator

`@seogod/ai-orchestrator` coordinates **specialist agents into deterministic,
validated, recoverable workflows**. It is the execution layer above the
decision engine and the agents are black boxes: the orchestrator performs no
SEO work and holds no business logic. Every decision arrives as an
`ExecutionPlan` from `@seogod/decision-engine`, and agents only produce content
for already-decided actions.

Everything is deterministic and observable: ids are derived from stable
business keys, every step and agent call is recorded, workflows can be
checkpointed and resumed, and high-risk actions are rejected before they touch
a store.

## Architecture

```
ExecutionPlan (decision-engine)
  └─ WorkflowPlanner.plan()        deterministic plan → AgentWorkflow
      └─ AgentRegistry.resolve()   agent per actionType (health, priority, id)
      └─ defaultTaskSchema()       output contract: action + resourceId
  └─ WorkflowEngine.run()          dependency graph, retries, timeouts, cancel
      └─ ExecutionEngine.executeAgentStep()   attempt loop, rate limit
          └─ AgentRunner.execute()            prompt → provider → parse
              └─ ResponseValidator            extract + schema match
              └─ SafetyGuard                  allowedActions + unsafe set
              └─ PromptBuilder / ContextBuilder / MemoryStore
  → WorkflowResult (execution + report + trace + agentExecutions)
```

## Determinism

- **Stable ids** — every record id is a UUIDv5 over business keys:
  `workflow-definition = uuid5('workflow-definition', planId)`,
  `execution = uuid5('workflow:' + storeId, definitionId)`,
  `agent-task = uuid5('agent-task', workflowId + '\u0000' + stepId)`,
  `trace = uuid5('trace', executionId)`. Re-running a plan reproduces the same
  ids and the same execution.
- **Stable agent resolution** — the planner picks one agent per task type by
  sorting candidates by health (`ok` first), then priority (low first), then id.
- **Deterministic steps** — a plan becomes one sequential list of parallel
  batches in the plan's batch order; conditional branches read prior outputs
  and resolve to fixed paths.

## Usage

```ts
import { Orchestrator, DefaultProviderFactory } from '@seogod/ai-orchestrator';
import { WorkflowPlanner, AgentRegistry } from '@seogod/ai-orchestrator';
import type { ExecutionPlan } from '@seogod/decision-engine';

const registry = new AgentRegistry();
registry.register({
  id: 'title-writer', name: 'Title Writer', version: '1.0.0',
  capabilities: ['writing'], supportedTasks: ['update_title'],
  maxConcurrency: 4, priority: 10,
  health: { status: 'ok', lastCheckedAt: new Date() },
  provider: 'openai', model: 'gpt-4o-mini',
});

const orchestrator = new Orchestrator({
  registry,
  providers: new DefaultProviderFactory([{ name: 'openai', model: 'gpt-4o-mini' }]),
  // optional: repository, memory, eventBus, metrics, logger, scheduler, now, ...
});

// 1. Turn an approved decision-engine plan into a workflow
const workflow = new WorkflowPlanner({ registry }).plan(plan);

// 2. Execute it (deterministic id, checkpointed, recoverable)
const { execution, report, trace } = await orchestrator.startWorkflow(workflow, {
  inputs: {},
  contextSources: { storeMetadata: { name: 'Acme' } },
  signal: controller.signal,          // optional cancellation
  timeoutMs: 60_000,                  // optional budget override
});

// 3. Resume a checkpointed run
const resumed = await orchestrator.recoverWorkflow(execution.id);

// 4. Run a single agent task directly
const result = await orchestrator.runAgentTask(task);
```

## Planner

`WorkflowPlanner` converts an `ExecutionPlan` into an `AgentWorkflow`:
a `definition` (deterministic, stable id), `assignments` (step → agent), and
`source` (plan metadata). One parallel group is created per batch, ordered by
`batch.order`, with `maxConcurrency` defaulting to the batch size. Each agent
step carries:

- `agentId` resolved through `AgentRegistry` (or an injected `resolveAgent`).
- `schema` from `defaultTaskSchema(task)` — an object contract whose `action`
  enum is pinned to the task's `actionType` and which requires `resourceId`.
  Override via `taskSchemaBuilder`.
- `allowedActions: [task.actionType]` — the agent may only propose the exact
  action the plan already decided.
- a deterministic `timeoutMs` (60s default).

## Workflow engine

`WorkflowEngine.run(definition, inputs, options)` executes any valid
definition (planner output or hand-built):

- **Step kinds** — `agent`, `sequential`, `parallel`, and `conditional`
  (operators `eq | ne | exists | not_exists | gt | lt | contains` on prior
  outputs).
- **Dependency edges** — steps start once every id in `dependsOn` completes;
  unsatisfiable graphs fail deterministically with a cycle error.
- **Retries and timeouts** — per-step `maxAttempts` and `timeoutMs` (via
  `withTimeout`), plus an overall workflow budget (`definition.timeoutMs` or a
  run-level `timeoutMs`).
- **Cancellation** — an external `AbortSignal` cancels the run; the execution
  is marked `CANCELLED`.
- **Checkpoints and recovery** — after every top-level step the execution is
  checkpointed; `recoverWorkflow` resumes, skipping completed steps.
- **Failure model** — a failing step fails the workflow and every remaining
  step is recorded as `SKIPPED` (deterministic partial failure).

## Execution and agent runner

`ExecutionEngine.executeAgentStep` runs the attempt loop: builds the task
through the injected `AgentTaskFactory`, respects `maxAttempts` and per-step
timeout, rate-limits starts (`maxRatePerSecond`), and records an
`AgentExecution` per attempt. The `AgentRunner` (the default executor)
orchestrates one attempt:

1. **Context** — `ContextBuilder` assembles store/graph/issues/recommendation
   sections with token budgets; oversized sections are truncated or cleared.
2. **Prompt** — `PromptBuilder` renders the agent template with the context.
3. **Provider** — a `ProviderFactory` resolves the configured provider and
   calls the model.
4. **Validation** — `ResponseValidator` extracts JSON (`extractJson`) and
   matches it against the step schema.
5. **Safety** — `SafetyGuard` verifies every proposed action is within the
   step's `allowedActions`; the unsafe set (`delete_page`, `remove_redirect`,
   `remove_internal_links`, `remove_image`, `remove_structured_data`) is always
   rejected. Non-object validation data maps to a `null` result.
6. **Memory** — each task records an entry in the `MemoryStore` for later
   retrieval.

## Persistence

The `OrchestratorRepository` interface isolates storage; the in-memory
`InMemoryOrchestratorRepository` is the default. Records:

- `WorkflowDefinition` — the planned definition, persisted before execution.
- `WorkflowExecution` — status, steps, outputs, timestamps, checkpoint state.
- `ExecutionTrace` — ordered `TraceEvent`s for the whole run.
- `MemoryEntry` — typed, queryable memory (`storeId`, `kind`, `key`, `data`).

`MemoryStore` views over the repository (`RepositoryMemoryStore`) or standalone
(`InMemoryMemoryStore`) provide `add`, `query`, and `latest`.

## Events and metrics

| Event               | When                                   |
| ------------------- | -------------------------------------- |
| `workflow.started`  | workflow begins                        |
| `workflow.completed`| workflow finished                      |
| `workflow.failed`   | workflow failed / cancelled / timed out|
| `agent.started`     | agent attempt begins                   |
| `agent.completed`   | agent attempt succeeded                |
| `agent.failed`      | agent attempt failed                   |
| `agent.retry`       | attempt will be retried                |
| `validation.failed` | model output failed validation         |

Trace events record `workflow.started`, `workflow.completed`,
`workflow.failed`, `step.*`, and `agent.*` with deterministic ordering.

Metrics (all optional): `workflow_count`, `workflow_duration`,
`agent_duration`, `provider_latency`, `token_usage`, `estimated_cost`,
`agent_failures`. Events publish through the optional `EventBus`
(`@seogod/events`) as outbox-compatible messages; publish failures are logged,
never fatal.

## Errors

Domain failures use `OrchestratorError` and its subclasses (`TimeoutError`,
`CancelledError`, `ValidationFailedError`, `SafetyViolationError`,
`UnsupportedProviderError`). Invalid input and missing records map to the
`@seogod/core` hierarchy (`ValidationError`, `NotFoundError`, `ConflictError`).

## Testing

```bash
npm run test --workspace @seogod/ai-orchestrator
npm run test:coverage --workspace @seogod/ai-orchestrator
```

The suite covers the planner, workflow/execution engines, agent runner,
validation, safety, context/prompt building, providers, scheduler, rate
limiter, models, and the `Orchestrator` facade. Coverage thresholds (95%) are
enforced for lines, branches, functions, and statements.

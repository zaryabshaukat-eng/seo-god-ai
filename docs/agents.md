# Agents

`@seogod/agents` is the **deterministic analysis and proposal layer** of the
SEO platform. Thirteen specialist agents read store data and return validated
recommendations and *proposed* actions. Agents are black boxes that perform no
SEO work themselves and **never execute a change**: everything they produce is
a proposal that the decision engine and human approval must pass before any
store is touched.

There are no model calls here. Every agent is a pure, mechanical analyzer that
derives evidence directly from the input, so results are reproducible and
testable. When a downstream layer needs LLM drafting, it runs the agent's
versioned prompt through `@seogod/ai-orchestrator` instead.

## Architecture

```
AgentService.invoke(agentId, input)
  ├─ registry.get(agentId)              agent metadata + schemas
  ├─ validateSchema(input, agent.inputSchema)
  ├─ ContextBuilderImpl.build()         token-budgeted context sections
  ├─ agent.analyze(input)               deterministic recommendation engine
  ├─ OutputValidator.validate()         contract + schema + allowed actions
  ├─ DefaultSafetyGuard.assertSafe()    rejected/sensitive actions, approvals
  ├─ AgentRunModel.build()              run record (duration, cost, tokens)
  ├─ AgentMemory.record*()              history / performance / feedback
  ├─ metrics.*()                        runs, tokens, cost, failures
  └─ emit(event)                        agent.* / recommendation.* events
```

## The agents

| Agent              | Analyzes                                        | Proposes                                            |
| ------------------ | ----------------------------------------------- | --------------------------------------------------- |
| `metadata`         | meta title/description presence, length, dupes  | `update_title`, `update_meta_description`           |
| `technical-seo`    | canonicals, robots, redirects, broken pages     | `update_canonical`, `update_robots`                 |
| `content`          | body volume, H1 structure, duplication          | recommendations + executionHints, never actions     |
| `keyword`          | focus-keyword placement (title/body/url)        | `update_title` + body/slug hints                    |
| `internal-linking` | broken links, orphans, inbound/outbound profile | `add_internal_links`, `fix_internal_links`          |
| `schema`           | JSON-LD presence, validity, expected type       | `add_structured_data`, `remove_structured_data`     |
| `image-seo`        | alt text (derived from file name/entity name), payload size | `update_alt_text`                       |
| `product`          | descriptions, images, titles, duplicate titles  | `update_title`                                      |
| `collections`      | descriptions, copy volume, coverage, titles     | `update_title`                                      |
| `blog`             | article copy volume, excerpts, titles           | `update_meta_description`                           |
| `page`             | broken pages, thin content, titles, homepage    | recommendations + hints, never delete/create       |
| `reporting`        | aggregates other agents' recommendations        | summary + top-opportunities, never actions          |
| `analytics`        | outcomes (impressions, clicks, CTR, positions)  | recommendations, never actions                      |

`reporting` and `analytics` declare **zero** action types: they inform, they do
not propose changes. `content` and `page` likewise never fabricate copy or
destructive edits — their fixes are recommendations with `executionHints`.

## Output contract

Every agent returns an `AgentResult`:

- **`recommendations`** — each carries a stable `rule` id (`<agent>.<rule>`),
  a severity, confidence, estimated impact, risk, and `evidence` pinned to
  fields in the input.
- **`actions`** — concrete `AgentAction`s: `actionType` from the 24
  `KNOWN_ACTION_TYPES`, `resourceType` from the 6 `KNOWN_RESOURCE_TYPES`
  (product, collection, page, blog, article, store), plus payload, priority,
  and estimated seconds.
- `confidence`, `risk`, and `estimatedImpact` are derived from the parts by
  `BaseAgent.result()` when not overridden.

## Validation

`OutputValidator` runs on every result before it leaves the service:

- contract checks (`agentId`, `taskId`, `status`, bounds on confidence/impact),
- the agent's declared `outputSchema` (a small custom JSON-schema subset with
  unions, enums, lengths, patterns and numeric bounds — no external validator),
- recommendation/action field checks,
- `unsupported-operation` for unknown action/resource types and
  `hallucinated-action` for action types the agent does not declare.

Failures produce `ValidationFailure[]` records and a `ValidationError`
(`@seogod/core`) when asserted.

## Safety

`DefaultSafetyGuard` enforces the platform policy on every result:

- `REJECTED_ACTION_TYPES` (`delete_page`, `remove_redirect`, `create_page`)
  throw a `SafetyViolationError` immediately.
- Actions must target a `resourceId` present in the input.
- HIGH/CRITICAL recommendations are forced to `approvalRequired: true`.
- `SENSITIVE_ACTION_TYPES` get a `[approval required]` rationale prefix so no
  sensitive change can slip through without review.

## Context

`ContextBuilderImpl` builds a minimal context (task, entities, store, settings,
context) and compresses it deterministically to a token budget: low-priority
sections (`context`, `settings`, `store`) are dropped first, then remaining
values are truncated. `estimateTokens` approximates `ceil(chars / 4)`.

## Memory, repository, registry

- `AgentMemory` records history, performance, and feedback entries, and records
  validation failures per recommendation.
- `InMemoryAgentRepository` (default) stores runs, validation failures, and
  feedback, and computes `performanceSnapshot` averages.
- `AgentRegistry` holds agent definitions; `buildDefaultRegistry()` wires the
  thirteen agents together.

## Events and metrics

| Event                    | When                                          |
| ------------------------ | --------------------------------------------- |
| `agent.registered`       | an agent is registered                        |
| `agent.invoked`          | an invocation begins                          |
| `agent.completed`        | an invocation succeeds                        |
| `agent.failed`           | an invocation fails (validation, safety, or unexpected) |
| `recommendation.generated` | a validated recommendation is produced      |
| `recommendation.rejected`  | a recommendation is rejected downstream     |

Events publish through the optional `EventBus` (`@seogod/events`) as
outbox-compatible messages; publish failures are logged, never fatal.

Metrics (all optional): `agent_runs`, `agent_failures`, `token_usage`,
`estimated_cost`, `agent_duration`, `validation_failures`, and the gauges
`average_confidence`, `average_tokens`.

## Usage

```ts
import { AgentService, buildDefaultRegistry } from '@seogod/agents';

const service = new AgentService({ registry: buildDefaultRegistry() });

const result = await service.invoke('metadata', {
  storeId: 'store-1',
  workflowId: 'workflow-1',
  taskId: 'task-1',
  entities: [
    { id: 'p1', type: 'page', ref: 'https://acme.example/p/1', data: { title: 'Widget' } },
  ],
  settings: { locale: 'en' },
}, { model: 'gpt-4o-mini' });

// result.result.recommendations  — validated, safety-checked proposals
// result.result.actions          — proposed (never executed) actions
// result.run                     — recorded AgentRun
```

Custom agents extend `BaseAgent` and implement `analyze`; the base class
provides entity/data accessors, `buildRecommendation`, `buildAction`, and
`result`.

## Testing

```bash
npm run test --workspace @seogod/agents
npm run test:coverage --workspace @seogod/agents
```

The suite covers every agent, schema/validator, safety policy and guard,
context builder, prompt templates/loader, memory, repository, registry, models,
utilities, and the `AgentService` facade (including end-to-end invocation with
a stub event bus and metrics registry). Coverage thresholds (95%) are enforced
for lines, branches, functions, and statements.

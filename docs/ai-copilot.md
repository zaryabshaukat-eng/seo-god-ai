# AI Copilot

`@seogod/ai-copilot` is the conversational AI assistant for the platform: a
tenant-isolated chat surface over the platform's deterministic engines. It
turns plain-language questions ("what should I fix first?", "show me the last
crawl") into streamed answers, tool calls and follow-up turns.

The package is pure computation plus in-memory stores. It depends only on
`@seogod/core` (error model) and `@seogod/monitoring` (metrics). Everything the
copilot reads — recommendations, observability, learning signals, reports and
optimization plans — flows in through structural interfaces, and the chat
model, authorizer and audit logger are injected. Upstream packages are
dev-only dependencies used for adapter typing and integration tests.

## Architecture

```
CopilotService                            (conversation loop)
  ├─ registry     ToolRegistry            10 default tools (recommendations, metrics,
  │                                        crawl, execution, alerts, plans, reports)
  ├─ prompts      PromptLibrary           system + 7 topic prompts, intent classifier
  ├─ store        ConversationStore       session memory (in-memory by default)
  ├─ model        ChatModel               streaming provider contract
  ├─ sources      CopilotSources          structural readers for platform data
  ├─ authorize    Authorizer              RBAC gate for chat + every tool call
  ├─ audit        AuditLogger             copilot.* audit entries
  └─ metrics      CopilotMetrics          copilot_* counters/timings
```

`runConversation` drives the loop: validate input, create or resume the
session, classify the intent into a topic prompt, stream model chunks (delta /
tool-call / done / error), execute tool calls with per-tool permission checks,
feed results back, and stop when the model answers or the tool-call cap is
reached. `chat` collects the stream into a single `ChatResponse`.

## Sessions and memory

- `createSession` starts a conversation with the rendered system prompt
  (listing the tool capabilities) and persists it to the conversation store.
- Every session is tenant-scoped; `getSession` and `deleteSession` reject
  cross-tenant access with `CopilotIsolationError`.
- `InMemoryConversationStore` is the default; any persistence can be injected
  behind the `ConversationStore` interface.
- `windowMessages` keeps the leading system message plus the most recent N
  messages (default history 20, clamped 0–100).

## Streaming contract

`ChatModel` is the only model interface:

```ts
interface ChatModel {
  name: string;
  models: string[];
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}
```

Chunks are `delta`, `tool-call`, `done` (authoritative text/usage/model) and
`error`. `fromOrchestratorProvider(provider)` adapts an `@seogod/ai-orchestrator`
`Provider` into a `ChatModel` (completion-style; tool results are flattened
into assistant messages), and `completeStream` turns a chunk stream into a
single `ModelResponse` for non-streaming use.

## Tools and permissions

The default tool set (all opt-out via `CopilotSources`):

| Tool                        | Reads                                                    | Permission |
| --------------------------- | -------------------------------------------------------- | ---------- |
| `list_recommendations`      | recommendations (with rule/limit filters)                | `org.read` |
| `explain_recommendation`    | a single recommendation by id or rule                    | `org.read` |
| `interpret_metrics`         | overview, executions, crawl, alerts, KPI report          | `org.read` |
| `summarize_crawl`           | latest crawl summary                                     | `org.read` |
| `summarize_execution`       | latest execution summary                                 | `org.read` |
| `get_alerts`                | recent alerts                                            | `org.read` |
| `list_plans`                | recent optimization plans                                | `org.read` |
| `generate_optimization_plan`| ranked plan + risk/approval flags                        | `org.manage` |
| `suggest_safe_actions`      | actions that need no approval                            | `org.manage` |
| `generate_report`           | executive-dashboard / seo / kpi / trends / alerts        | `org.read` |

`COPILOT_PERMISSIONS` uses the enterprise vocabulary (`tenant.read`,
`org.read`, `org.manage`, `audit.read`). An `Authorizer` can be built from an
enterprise role policy (`fromRolePolicy`), an `EnterpriseService.authorize`
(`fromEnterprise`), or omitted (allow-all) for local use. Chat itself is gated
on `tenant.read`; each tool on its own permission. Denials are audited as
`copilot.permission.denied`.

## Audit and metrics

- Audit actions: `copilot.chat`, `copilot.tool`,
  `copilot.session.created`, `copilot.session.deleted`,
  `copilot.permission.denied`, `copilot.error`. Wire `fromEnterpriseAudit` to
  the enterprise `AuditService`, or supply any `AuditLogger`.
- Metrics (`copilot_messages`, `copilot_sessions`, `copilot_turns`,
  `copilot_tool_calls`, `copilot_tool_errors`, `copilot_permission_denied`,
  `copilot_model_errors`, `copilot_tokens`, `copilot_latency_ms`): wire a
  metrics registry via `fromMetricsRegistry`, or use the no-op default.

## Errors

All errors extend `AppError` (via `@seogod/core`) with `module: 'ai-copilot'`:
`CopilotError`, `CopilotValidationError`, `CopilotNotFoundError`,
`CopilotAuthorizationError`, `CopilotIsolationError`, `CopilotProviderError`,
`CopilotToolError`.

## Usage

```ts
import { CopilotService, fromOrchestratorProvider, fromEnterprise, fromEnterpriseAudit, fromObservability, fromReportEngine } from '@seogod/ai-copilot';

const service = new CopilotService({
  model: fromOrchestratorProvider(provider),
  sources: {
    observability: fromObservability(observabilityService),
    reports: fromReportEngine(reportEngineService),
  },
  authorize: fromEnterprise((role, permission, context) => enterprise.authorize(role, permission, context)),
  audit: fromEnterpriseAudit(enterprise.audit),
});

for await (const event of service.stream({ message: 'What should I fix first?', tenantId, userId })) {
  // 'tool-call' | 'tool-result' | 'delta' | 'done'
}
```

## Testing

```bash
npm run test --workspace @seogod/ai-copilot
npm run test:coverage --workspace @seogod/ai-copilot
```

The suite covers prompts and intent classification, the conversation store,
provider streaming and the orchestrator adapter, adapters against the real
observability, learning-engine, reports and enterprise services, tool
registry/execution (including degrade paths), permissions, audit, metrics,
errors and the full `CopilotService` loop. Coverage thresholds (95%) are
enforced for lines, branches, functions, and statements.

# Architecture

SEO GOD AI is a TypeScript monorepo managed with [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces). Each package owns a bounded concern, exposes a public API through `src/index.ts`, and ships compiled output under `dist/`.

## Packages

| Package                | Responsibility                                                        |
| ---------------------- | --------------------------------------------------------------------- |
| `@seogod/core`         | Shared `AppError` hierarchy and platform-wide error model             |
| `@seogod/config`       | Zod-validated, schema-defined configuration from environment          |
| `@seogod/logging`      | Structured pino logging with error serialization and redaction        |
| `@seogod/shared`       | Security primitives (AES-GCM, HMAC, hashing) and sanitization helpers |
| `@seogod/shopify`      | Shopify OAuth, Admin GraphQL client, encrypted token storage          |
| `@seogod/database`     | Prisma schema, initial migration, repositories, seed data             |
| `@seogod/audit`        | Immutable audit trail over the `AuditLog` table                       |
| `@seogod/events`       | Transactional outbox event bus with retries and backoff               |
| `@seogod/monitoring`   | Health checks, metrics registry, `/health` `/ready` `/metrics` server |
| `@seogod/crawler`      | Site crawl engine: scheduling, robots/rate-limit safety, extraction   |
| `@seogod/seo-engine`   | Deterministic, evidence-backed SEO scoring and recommendations        |
| `@seogod/knowledge-graph` | Versioned relationship layer: nodes, edges, queries, scoring        |
| `@seogod/decision-engine` | Deterministic planning, approval, and rollback-ready execution      |
| `@seogod/execution-engine` | The only package allowed to write to Shopify: validated, safety-gated, rollback-ready execution |
| `@seogod/observability`    | Observability engine: immutable history, execution records, metrics, alerts, learning signals |
| `@seogod/google-integrations` | Google Search Console, GA4, PageSpeed, Rich Results and Indexing clients with OAuth, credential management and incremental sync |
| `@seogod/ai-orchestrator` | Coordinates agents into deterministic, validated, recoverable workflows |
| `@seogod/agents`         | Deterministic, validated SEO analysis and proposals from 13 specialist agents |
| `@seogod/scheduler`      | Autonomous job scheduling: cron/one-shot jobs, priority queues, retries, locking, outbox events |
| `@seogod/learning-engine` | Feedback collection, outcome analysis, confidence calibration, learned scoring, RL signals, decision-engine historical outcomes |
| `@seogod/reports`        | Executive dashboards, SEO/KPI/trend/alert reports, JSON/CSV/PDF export, KPI tracking, scheduled report runs |
| `@seogod/enterprise`     | Multi-tenant tenants, orgs/teams with RBAC, immutable audit log, scoped API keys, signed webhooks, billing entitlements |
| `@seogod/ai-copilot`     | Conversational AI assistant: streaming chat, session memory, tool calling, prompt management, RBAC, audit, metrics |

Planned packages and applications: `ai`, `safety`, `ui`, plus the `apps/api` and `apps/dashboard` applications.

## Dependency rules

- Dependencies flow downward: `core` has no internal dependencies; `config` and `shared` depend on `core`; `logging` depends on `config` and `core`; `database`, `audit`, `events`, `monitoring` depend on the layer below them. `shopify` depends on `core`, `shared`, and `logging`. `observability` depends on `crawler`, `events` and `execution-engine`, and consumes `monitoring` structurally (a `MetricsRegistry` is injected via options rather than imported). `google-integrations` depends on `core`, `shared`, `logging`, `events` and `monitoring`. `scheduler` depends on `core`, `events`, `logging` and `monitoring`, and consumes handlers structurally. `learning-engine` depends on `core` and `monitoring`, and consumes the decision engine and observability structurally (their records flow in through `ExecutionResultLike` / `ExecutionRecordLike` / `LearningSignalLike`, so they are dev-only dependencies). `reports` depends on `core` and `monitoring`, and consumes observability, learning-engine, decision-engine and google-integrations structurally (their readers flow in through `ReportSources`, so they are dev-only dependencies). `enterprise` depends on `core` and `monitoring`, and consumes external providers structurally (webhook delivery, billing hooks and metrics are injected via options). `ai-copilot` depends on `core` and `monitoring`, and consumes the orchestrator, observability, learning-engine, reports, decision-engine and enterprise structurally (their models and services flow in through `CopilotSources`, adapters and injected authorizers/audit loggers, so they are dev-only dependencies).
- Circular imports are forbidden and enforced by dependency-cruiser (`npm run cycles`). A new package must be added to the root `build` script in topological order.
- ESLint restricts access to `process.env` to `@seogod/config` only. No other package may read environment variables directly.
- `console.log` is forbidden; use the structured logger (`@seogod/logging`).

## Resolution strategy

Three configurations resolve `@seogod/*` imports differently:

| Context        | Mechanism                                                        |
| -------------- | ---------------------------------------------------------------- |
| Typecheck      | `tsconfig.paths.json` maps `@seogod/*` to each package's `src/index.ts` |
| Vitest         | `vitest.aliases.ts` maps the same names to source entry points    |
| Build (`dist`) | npm workspace symlinks resolve to each package's built `dist`     |

The source-mapped typecheck/alias setup only applies to development; production builds compile each package independently with `tsconfig.build.json`.

## Quality gates

Every package must pass before it is committed:

```bash
npm run build          # topological, from clean state
npm run typecheck
npm run lint
npm run test
npm run test:coverage  # 95% per metric, per package
npm run cycles         # 0 errors
```

Coverage excludes entry points (`src/index.ts`) and Prisma's client singleton, which are glue rather than logic.

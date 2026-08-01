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

Planned Sprint 2+ packages: `agents`, `ai`, `crawler`, `reports`, `safety`, `seo-engine`, `ui`, plus the `apps/api` and `apps/dashboard` applications.

## Dependency rules

- Dependencies flow downward: `core` has no internal dependencies; `config` and `shared` depend on `core`; `logging` depends on `config` and `core`; `database`, `audit`, `events`, `monitoring` depend on the layer below them. `shopify` depends on `core`, `shared`, and `logging`.
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
npm run test:coverage  # 90% per metric, per package
npm run cycles         # 0 errors
```

Coverage excludes entry points (`src/index.ts`) and Prisma's client singleton, which are glue rather than logic.

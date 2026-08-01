# Database

`@seogod/database` owns the Prisma schema, the initial migration, repositories, and seed data. No other package may define tables or run migrations.

## Schema

See `packages/database/prisma/schema.prisma`. Tables:

| Model          | Purpose                                                |
| -------------- | ------------------------------------------------------ |
| `Store`        | A connected Shopify store (domain, tokens, plan state) |
| `CrawlJob`     | A crawl run against a store (`PENDING|RUNNING|DONE|FAILED`) |
| `Page`         | A crawled page, unique per `crawlJobId` + `url`        |
| `SeoIssue`     | An SEO issue found on a page, keyed by rule            |
| `AuditLog`     | Immutable, append-only audit trail (see `@seogod/audit`) |
| `OutboxEvent`  | Transactional outbox backing the event bus (see `@seogod/events`) |
| `ApprovalRequest` | Human-approval gate for high-impact actions          |

## Client

```ts
import { getPrismaClient, createPrismaClient, disconnectPrisma } from '@seogod/database';

const db = getPrismaClient();       // cached singleton
disconnectPrisma();                 // graceful shutdown
```

The Prisma client logs `warn` and `error` levels through the structured logger.

## Repositories

Repositories encapsulate table access and accept a `PrismaClient` (constructor injection) so tests use typed fakes:

- `StoreRepository` — `upsert`, `get`, `getOrThrow`, `delete`, `list`.
- `CrawlJobRepository` — `create`, `markRunning`, `markFinished`, `listRecent`.
- `PageRepository` — `upsert` (by `crawlJobId` + `url`), `countByJob`, `listByJob`.
- `SeoIssueRepository` — `createMany`, `countByPage`.

## Scripts

| Script          | Command                   |
| --------------- | ------------------------- |
| Generate client | `npm run db:generate`     |
| Migrate dev     | `npm run db:migrate`      |
| Deploy          | `npm run db:deploy`       |
| Seed            | `npm run db:seed`         |
| Studio          | `npm run db:studio`       |

The initial migration was generated with `prisma migrate diff` so it can be created without a live database. Prisma has flagged that the `package.json#prisma` seed config is deprecated and will be removed in Prisma 7; a `prisma.config.ts` migration may be required later.

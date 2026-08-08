# API

The production HTTP API lives in `@seogod/api` (`apps/api`). It is a
dependency-light Node HTTP server that combines the domain services of the
platform behind a versioned REST surface, adds AI Copilot and real-time
streaming, and ships a generated OpenAPI document and TypeScript SDK.

The server is implemented in `apps/api/src/server.ts` with no framework: a
small router (`router.ts`), typed guards (`guards.ts`), and a JSON error
envelope (`errors.ts`).

## Conventions

- **Base path** — every route is namespaced under `/api/v1`.
- **OpenAPI** — a live `3.0.3` document is generated from the route table and
  served at `GET /api/v1/openapi.json` (anonymous). Version `0.3.5`.
- **SDK** — a standalone TypeScript client is rendered from the same route
  table and served at `GET /api/v1/sdk.ts` (anonymous). It exports a
  `SeoGodSdk` class and an `ApiClient` (see `apps/api/src/sdk.ts`).
- **Auth** — all endpoints require a bearer token except the ones explicitly
  marked anonymous (register, login, refresh, reset-password, openapi, sdk).
- **Errors** — non-streaming errors return the envelope below with an
  appropriate status code (400/401/403/404/409/429/500).

## Authentication and authorization

Sessions are issued by `POST /api/v1/auth/register` and
`POST /api/v1/auth/login`. Use the returned `accessToken` as
`Authorization: Bearer <token>`. Tokens are opaque bearer strings managed by
the in-memory auth service (`apps/api/src/auth.ts`); `refresh` rotates a
refresh token into a fresh pair, and `logout` revokes the current session.

```bash
curl -X POST /api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"secret"}'
# -> 200 { "tokens": { "accessToken": "...", "refreshToken": "..." } }
```

- Anonymous: `register`, `login`, `refresh`, `reset-password`,
  `openapi.json`, `sdk.ts`.
- Everything else requires a bearer token scoped to the caller's tenant.
- Permissions are enforced per route via `PlatformPermissions` in
  `apps/api/src/permissions.ts`; `GET /api/v1/auth/me` returns the caller's
  `permissions` array so clients can render UI. API keys (see Admin) can
  authenticate in place of a session token with a narrower scope.

## Error envelope

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Email is required.",
    "context": {},
    "retryable": false
  }
}
```

`code` values include `validation_failed`, `unauthorized`, `forbidden`,
`not_found`, `conflict`, `rate_limited`, `invalid_response`, and generic
`request_failed`. Status codes: `400` bad request / validation, `401`
missing or invalid token, `403` insufficient permission, `404` unknown
resource, `409` conflict (duplicate email/tenant), `429` rate limited.

## Endpoints

### Auth

| Method | Path                       | Operation          | Auth   |
| ------ | -------------------------- | ------------------ | ------ |
| POST   | `/auth/register`           | `register`         | none   |
| POST   | `/auth/login`              | `login`            | none   |
| POST   | `/auth/refresh`            | `refresh`          | none   |
| POST   | `/auth/reset-password`     | `requestPasswordReset` | none |
| GET    | `/auth/me`                 | `me`               | bearer |
| POST   | `/auth/logout`             | `logout`           | bearer |

`register` takes `{ name, email, password, storeName }`, provisions a tenant
(via `@seogod/enterprise`) and returns `{ tenant, user, store, tokens }`.
`me` returns `{ user: { id, email, role }, permissions: string[] }`.

### Dashboard

| Method | Path                     | Operation          | Query            |
| ------ | ------------------------ | ------------------ | ---------------- |
| GET    | `/dashboard/overview`    | `dashboardOverview`| `storeId`        |
| GET    | `/dashboard/trends`      | `dashboardTrends`  | `storeId`, `limit` |

`overview` returns dashboard KPIs plus settings and unread notifications;
`trends` returns SEO, execution and performance timelines.

### Crawls

| Method | Path                | Operation   | Query / body |
| ------ | ------------------- | ----------- | ------------ |
| GET    | `/crawls`           | `listCrawls`| `storeId`    |
| POST   | `/crawls`           | `startCrawl`| `{ storeId, seeds? }` |
| GET    | `/crawls/:id`       | `getCrawl`  | —            |
| POST   | `/crawls/:id/cancel`| `cancelCrawl` | —         |

`POST /crawls` requires `storeId`; `seeds` defaults to
`https://<storeId>.myshopify.com/`. Crawl statuses are normalized:
`queued | running | completed | failed | cancelled`. Responses wrap jobs as
`{ crawls: [...] }`, `{ crawl: {...} }`, or `{ crawl, statistics }` on start.

### SEO

| Method | Path                        | Operation  | Query / body |
| ------ | --------------------------- | ---------- | ------------ |
| GET    | `/seo/recommendations`      | `listRecommendations` | `storeId` |
| GET    | `/seo/breakdown`            | `seoBreakdown` | `storeId` |
| PATCH  | `/seo/recommendations/:id`  | `updateRecommendationStatus` | `{ status }` |

Recommendations are derived from the latest observability snapshot
(`apps/api/src/controllers/crawls.ts`), one per scoring category, with
`severity` derived from the score (`high` < 50, `medium` < 75, else `low`)
and a mutable `status` (`open | planned | resolved`) stored in
`platform.recommendationOverrides`.

### Executions

| Method | Path                      | Operation | Body |
| ------ | ------------------------- | --------- | ---- |
| GET    | `/executions`             | `listExecutions` | `storeId` |
| GET    | `/executions/:id`         | `getExecution` | — |
| POST   | `/executions/:id/approve` | `approveExecution` | — |
| POST   | `/executions/:id/reject`  | `rejectExecution` | — |
| POST   | `/executions/:id/rollback`| `rollbackExecution` | — |
| POST   | `/executions/:id/run`     | `runExecution` | — |

Executions are observability records overlaid with the platform approval
state machine. `list`/`get` return `{ executions: [...] }` / `{ execution }`
with `status` from `platform.executionStates` (approved, cancelled,
rolled-back, running) falling back to the record status. Action endpoints
return `{ id, status, action }` and `404` for unknown ids.

### Observability

| Method | Path                             | Operation  | Query |
| ------ | -------------------------------- | ---------- | ----- |
| GET    | `/observability/overview`        | `observabilityOverview` | `storeId` |
| GET    | `/observability/metrics`         | `executionMetrics` | `storeId` |
| GET    | `/observability/alerts`          | `listAlerts` | `storeId`, `limit` |
| GET    | `/observability/timeline`        | `observabilityTimeline` | `storeId`, `limit` |
| POST   | `/observability/alerts/:id/acknowledge` | `acknowledgeAlert` | `{ acknowledged? }` |

The timeline is the immutable history from `@seogod/observability`
(`getHistory`); alerts can be acknowledged/un-acknowledged.

### Reports

| Method | Path            | Operation   | Body |
| ------ | --------------- | ----------- | ---- |
| GET    | `/reports`      | `listReports` | —   |
| POST   | `/reports`      | `generateReport` | `{ kind, storeId?, days?, compare? }` |
| GET    | `/reports/:id`  | `getReport` | — |

`kind` is one of `executive-dashboard | seo | kpi | trends | alerts`.
Generation goes through `@seogod/reports`.

### Copilot (SSE)

| Method | Path               | Operation | Body |
| ------ | ------------------ | --------- | ---- |
| GET    | `/copilot/sessions`| `listCopilotSessions` | `storeId`, `limit` |
| POST   | `/copilot/chat`    | `copilotChat` | `{ message, storeId?, sessionId?, model?, temperature? }` |

`POST /copilot/chat` streams a conversation over Server-Sent Events
(`text/event-stream`). Events are JSON payloads:

```text
data: {"type":"start"}
data: {"type":"token","text":"..."}
data: {"type":"end","sessionId":"...","model":"..."}
data: {"type":"error","message":"..."}
```

Model failures surface as an `error` event rather than a hard failure;
non-`Error` failures are reported with a generic message. Copilot state lives
in `@seogod/ai-copilot`.

### Admin

| Method | Path                            | Operation | Body |
| ------ | ------------------------------- | --------- | ---- |
| GET    | `/admin/tenants`                | `listTenants` | — |
| POST   | `/admin/tenants`                | `createTenant` | `{ name, planId?, slug? }` |
| GET    | `/admin/orgs`                   | `listOrgs` | — |
| GET    | `/admin/teams`                  | `listTeams` | `organizationId` |
| GET    | `/admin/members`                | `listMembers` | — |
| POST   | `/admin/members/invite`         | `inviteMember` | `{ email, role, name?, organizationId? }` |
| PATCH  | `/admin/members/:id/role`       | `updateMemberRole` | `{ role }` |
| GET    | `/admin/audit`                  | `listAudit` | `limit`, `action` |
| GET    | `/admin/api-keys`               | `listApiKeys` | — |
| POST   | `/admin/api-keys`               | `createApiKey` | `{ label, scopes?, expiresInDays? }` |
| DELETE | `/admin/api-keys/:id`           | `revokeApiKey` | — |
| GET    | `/admin/billing`                | `getBilling` | — |

Roles are `owner | admin | member | viewer`. API keys default to the
`tenant.read` scopes and can be issued with `apikeys.manage` to mint child
keys. Audit is the immutable `@seogod/audit` log (`listAudit`). Billing
reports `@seogod/enterprise` subscription entitlements.

### Webhooks

| Method | Path                          | Operation | Body |
| ------ | ----------------------------- | --------- | ---- |
| GET    | `/admin/webhooks`             | `listWebhooks` | — |
| POST   | `/admin/webhooks`             | `createWebhook` | `{ url, events?, description? }` |
| PATCH  | `/admin/webhooks/:id`         | `updateWebhook` | partial endpoint object |
| DELETE | `/admin/webhooks/:id`         | `deleteWebhook` | — |
| GET    | `/admin/webhooks/deliveries`  | `listWebhookDeliveries` | — |
| POST   | `/admin/webhooks/:id/test`    | `testWebhook` | `{ type?, payload? }` |

Delivery goes through the platform's outbox (`nextAttemptAt`, attempts,
status) with an injected fetch implementation.

### Settings

| Method | Path                | Operation | Body |
| ------ | ------------------- | --------- | ---- |
| GET    | `/settings`         | `getSettings` | — |
| PUT    | `/settings`         | `updateSettings` | partial settings object |
| PATCH  | `/settings/profile` | `updateProfile` | partial profile |

Settings values are coerced to their typed form (`apps/api/src/settings.ts`);
an invalid boolean/number/string value falls back to a safe default instead
of failing the request.

### Notifications

| Method | Path                        | Operation | Body |
| ------ | --------------------------- | --------- | ---- |
| GET    | `/notifications`            | `listNotifications` | — |
| POST   | `/notifications`            | `createNotification` | `{ type, title, message, severity? }` |
| POST   | `/notifications/:id/read`   | `markNotificationRead` | — |
| POST   | `/notifications/read-all`   | `markAllNotificationsRead` | — |

`list` returns `{ notifications, unread }`. `severity` is
`info | warning | critical`.

### Realtime (SSE)

| Method | Path                 | Operation | Body |
| ------ | -------------------- | --------- | ---- |
| GET    | `/realtime/events`   | `realtimeEvents` | `channel` (comma-separated) |
| POST   | `/realtime/publish`  | `realtimePublish` | `{ channel, payload? }` |

`GET /realtime/events` is an SSE stream (`retry: 3000`) with per-channel
history replay. Subscribe to specific channels or `*` for everything; the
platform event bus republishes `crawl.completed` / `crawl.failed` on the
`crawls` channel (`apps/api/src/realtime.ts`):

```text
event: crawls
data: {"type":"crawl.completed","id":"...","aggregateId":"...","payload":{...}}
```

## Generated SDK

`GET /api/v1/sdk.ts` renders a dependency-free TypeScript client from the
live route table. `generateSdkSource(router)` produces the same output in
process and is exported from `apps/api/src/sdk.ts`:

```ts
import { ApiClient } from '@seogod/api';

const client = new ApiClient({ baseUrl: 'http://localhost:8787' });
await client.request('POST', '/api/v1/auth/login', { body: { email, password } });
```

`ApiRequestError` carries `status`, `code`, `message`, and the parsed body for
non-`ok` responses.

## Testing

```bash
npm run test -w @seogod/api
npm run test:coverage -w @seogod/api   # 95% thresholds enforced
npm run lint
npm run typecheck
npm run build
```

The API suite (6 files, 146 tests) covers the full route table end to end
against an in-memory platform (`apps/api/src/platform.ts`), the router,
guards, OpenAPI generation, the SDK generator/client, and the realtime hub.
Coverage thresholds (95%) are enforced for statements, branches, functions,
and lines in `apps/api/vitest.config.ts`.

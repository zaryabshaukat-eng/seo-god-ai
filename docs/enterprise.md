# Enterprise

`@seogod/enterprise` is the multi-tenant enterprise layer: tenants with hard
isolation guards, organizations/teams with role-based access control, an
immutable audit log, scoped API keys, signed webhooks and billing
entitlements.

Every record is tenant-scoped. The isolation layer (`TenantScopedStore` +
`withTenantScope` + `assertSameTenant`) checks the tenant id on every read and
write, so a cross-tenant access attempt is rejected with an
`EnterpriseIsolationError` rather than leaking data. The package is pure
computation plus in-memory stores: persistence, delivery and billing
providers are injected through small interfaces, so it stays dependency-free
apart from `@seogod/core` (error model) and `@seogod/monitoring` (optional
metrics).

## Architecture

```
EnterpriseService                       (composition root)
  ├─ tenant     TenantService           provision/suspend/activate, slug rules
  ├─ orgs       OrgService              organizations → teams → members, RBAC checks
  ├─ audit      AuditService            immutable audit log + retention purging
  ├─ apiKeys    ApiKeyService           hashed, scoped, revocable API keys
  ├─ webhooks   WebhookService          signed endpoint deliveries + retries
  ├─ billing    BillingService          plans, subscriptions, usage, entitlements
  ├─ rbac       RoleManager             owner/admin/member/viewer + custom roles
  └─ metrics    EnterpriseMetrics       enterprise_* counters/gauges
```

`EnterpriseService` also offers cross-cutting conveniences: `runInTenant`
(scoped execution), `authorize` (RBAC guard), `entitlementsFor` /
`enforceEntitlement` (composite usage vs. plan limits), and `verifyApiKey`.

## Tenants and isolation

`provision` creates a tenant with a validated, unique slug. Tenants can be
suspended (`suspend`), reactivated (`activate`), listed and removed;
`assertActive` gates operations on suspended tenants. All state is held in
`TenantScopedStore`s whose `find`/`save`/`list` methods reject any record whose
`tenantId` does not match the current scope.

## Organizations, teams, roles

`OrgService` manages organizations, teams and members:

- organizations and teams can be created, read, updated, listed and removed,
- `addMember` assigns a role and rejects duplicates,
- every mutation runs through `authorize(role, permission, context)`.

`RoleManager` maps the built-in roles (`owner`, `admin`, `member`, `viewer`)
to the 12 canonical permissions (`tenant.*`, `org.*`, `team.*`,
`member.manage`, `audit.read`, `apikey.manage`, `webhook.manage`,
`billing.*`) and supports `defineRole` for custom roles layered on top.
`requirePermission` throws `EnterpriseAuthorizationError` when the role lacks
the permission.

## Audit

`AuditService.record` appends an immutable `AuditLogEntry` (actor, tenant,
action, resource, outcome, IP, request id, timestamp). `query` filters by
tenant/action/actor/resource/date range, `get` reads one entry with an
isolation check, and `purgeOlderThan` / `purgeExpired` enforce the tenant's
retention window. `count` reports the per-tenant volume for metrics.

## API keys

`issueKey(tenantId, name, scopes)` returns a plaintext key exactly once (the
store keeps only a hash) and `verifyKey(plaintext, tenantId?)` verifies a
candidate, rejecting revoked or expired keys and enforcing scopes with
`hasScope` / `requireScope`. Keys can be revoked, listed and re-read; all
access is tenant-scoped.

## Webhooks

`WebhookService` manages endpoints (url, events, secret, enabled) and delivers
events:

- `dispatch(tenantId, event)` fans an event out to every enabled matching
  endpoint, skipping subscribers outside the tenant,
- each delivery is signed (HMAC of the body with the endpoint secret),
  recorded as a `WebhookDeliveryAttempt`, and retried with backoff when the
  deliverer reports failure,
- `deliver` uses the injected `WebhookDeliverer` (network stays external) and
  an optional injected clock (`now`, `delay`).

## Billing and entitlements

`BillingService` ships three default plans with hard limits:

| Resource            | free | pro   | enterprise |
| ------------------- | ---- | ----- | ---------- |
| Seats               | 5    | 25    | 500        |
| API keys            | 2    | 10    | 100        |
| Webhooks            | 1    | 5     | 25         |
| Audit retention     | 30d  | 180d  | 730d       |

Plans can be created, patched, deactivated and listed. `subscribe`,
`changePlan`, `cancelSubscription` and `getSubscription` manage the tenant's
current plan (with an optional `BillingHook` and `BillingEventSink` for
external billing). `recordUsage` and `syncSeats` accumulate usage, and
`entitlements(tenantId, usage)` computes the allowed/used/limit per resource.
`EnterpriseService.enforceEntitlement` throws `EnterpriseLimitError` when a
tenant has exhausted a resource (seats, API keys or webhooks).

## Errors

All failures are typed subclasses of `EnterpriseError` (`@seogod/core`):
validation, not-found, conflict, authorization, authentication, isolation and
billing errors carry an `EnterpriseErrorCode`, structured context, optional
cause, request id and retryability.

## Metrics

`EnterpriseMetrics` (optional `@seogod/monitoring` registry) records tenant
lifecycle actions, API key actions, webhook delivery outcomes, audit volume,
authorization denials, and a `seats_in_use` gauge per tenant.

## Usage

```ts
import { EnterpriseService, Permissions } from '@seogod/enterprise';

const enterprise = new EnterpriseService({
  webhookDeliverer: async (endpoint, body, headers) => {
    // POST to endpoint.url with HMAC-SHA256 signature
  },
  billingHook: { onSubscribe: async (event) => { /* provision billing */ } },
});

const tenant = await enterprise.tenant.provision({ slug: 'acme', name: 'Acme' });
const org = await enterprise.orgs.createOrganization(tenant.tenantId, 'Marketing');
await enterprise.orgs.addMember(tenant.tenantId, org.organizationId, 'user-1', 'admin');

enterprise.authorize('admin', Permissions.orgManage, {
  tenantId: tenant.tenantId,
});

const { plaintext, record } = enterprise.apiKeys.issueKey(tenant.tenantId, 'ci', ['billing.read']);
await enterprise.webhooks.register(tenant.tenantId, {
  url: 'https://acme.example/hooks/seo',
  events: ['recommendation.generated'],
});

await enterprise.enforceEntitlement(tenant.tenantId, 'webhooks');
await enterprise.webhooks.dispatch(tenant.tenantId, { tenantId: tenant.tenantId, type: 'recommendation.generated', payload: {} });
```

## Testing

```bash
npm run test --workspace @seogod/enterprise
npm run test:coverage --workspace @seogod/enterprise
```

The suite covers tenant lifecycle and isolation guards, organization/team/
member RBAC, the audit log and retention purging, API key hashing/scopes/
revocation, signed webhook deliveries with retries, plan entitlements and
usage, the error hierarchy and the `EnterpriseService` facade. Coverage
thresholds (95%) are enforced for lines, branches, functions and statements.

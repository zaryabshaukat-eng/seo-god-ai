# Google Integrations

`@seogod/google-integrations` provides the platform's Google APIs access:
Search Console, Analytics (GA4), PageSpeed Insights, Rich Results and the
Indexing API — plus the OAuth flow, encrypted credential management and
incremental sync that sit behind them.

The package is **provider-first and integration-neutral**: it only talks to
Google. It never reads a store, never writes to Shopify and never executes an
SEO change. The `GoogleIntegrationsService` facade ties the pieces together for
the API layer and the crawler/seo pipeline.

## Position in the platform

```
api / seo pipeline ── GoogleIntegrationsService
                        ├─ GoogleOAuth             authorization code + PKCE, token refresh, userinfo
                        ├─ CredentialManager       encrypted token storage + transparent refresh
                        ├─ GoogleHttpClient        authenticated JSON transport with retries
                        ├─ clients                 SearchConsole / Analytics / PageSpeed / RichResults / Indexing
                        ├─ IncrementalSync         per-provider, resumable state sync
                        ├─ GoogleMetrics           counters, histograms (optional)
                        └─ EventBusPublisher       google.* events (optional)
```

## OAuth and credentials

`GoogleOAuth` implements the **authorization-code flow with PKCE**:

- `buildAuthorizationUrl()` returns the Google consent URL with
  `code_challenge`, `code_challenge_method=S256` and a cryptographically random
  `state`.
- `handleCallback()` exchanges the code for tokens, validates the `state` when
  an expected value is provided, and enriches the profile with a
  `GET /oauth2/v2/userinfo` call (email → account key).
- `refreshToken()`, `revokeToken()` and a `_meta` endpoint hook for tests.

Tokens are stored by `CredentialManager` keyed `provider:account` (account is
the Google account email), encrypted with AES-256-GCM via `@seogod/shared`.
`CredentialManager.getValidCredential()` transparently refreshes tokens that are
within `EXPIRY_LEEWAY_MS` (30s) of expiring, so callers always receive a valid
token or a typed `GoogleTokenError`. `MemoryCredentialStorage` is the default;
`EncryptedCredentialStorage` (encrypted files) is available for local/dev use
and a durable store can implement the small `CredentialStorage` interface.

`GOOGLE_PROFILE_SCOPES` is the profile scope set
(`openid`, `profile`, `email`); `DEFAULT_PROVIDER_SCOPES` maps each provider
to its scopes (Search Console site-management/analytics, GA4 read-only,
PageSpeed Insights, Rich Results and Indexing).

## HTTP client

`GoogleHttpClient` is a typed JSON transport over `fetch`:

- `get()` / `post()` merge query params (arrays repeat the key), an
  `apiKey` and/or an `accessToken` (`Authorization: Bearer <token>`) into every
  request.
- Retries on `429`/`5xx` with exponential backoff plus `Retry-After` (capped),
  up to `maxRetries` (default 3, `0` disables).
- Decodes 204/empty bodies to `null`, and maps `4xx`/`429` to typed errors
  (`GoogleApiError`, `GoogleRateLimitError`), network failures to
  `GoogleNetworkError`.

## Clients

Each client is a thin typed wrapper around one Google REST API:

| Client               | API                                | Main methods                                        |
| -------------------- | ---------------------------------- | --------------------------------------------------- |
| `SearchConsoleClient`| Webmasters v3                      | `listSites`, `searchAnalytics`, `listSitemaps`, `submitSitemap` |
| `AnalyticsClient`    | GA4 Data `runReport`               | `runReport` (date ranges, dimensions, metrics, filters, limits) |
| `PageSpeedClient`    | PageSpeed Insights v5              | `analyze` (always sends `strategy`, defaults `mobile`) |
| `RichResultsClient`  | Rich Results (Search Console)      | `runTest` (screenshot + audio thumbnails), `testStatus` |
| `IndexingClient`     | Indexing API v3                    | `publish`, `notify` (URL-notification type)          |

The base URLs are exported as constants
(`SEARCH_CONSOLE_BASE_URL`, `ANALYTICS_BASE_URL`, `PAGESPEED_BASE_URL`,
`RICH_RESULTS_BASE_URL`, `INDEXING_BASE_URL`) so they can be overridden for
tests or proxies.

## Incremental sync

`IncrementalSync.sync()` performs a resumable, per-provider sync of
site/GA4/PageSpeed/RichResults/Indexing data for the request's store and
account. Behavior highlights:

- The **first run** syncs the whole configured window; later runs continue from
  the last successful run's cursor (tracked in the `GoogleSyncRepository`).
- It is **idempotent** — a provider that already ran successfully is skipped.
- `startDate`/`endDate` can be forced per call; defaults come from the clock
  and the first-run window (`DEFAULT_FIRST_RUN_WINDOW_DAYS` = 28).
- Providers that fail without an access token (site / GA4 / PageSpeed /
  Rich Results) are skipped and reported, not fatal.
- Every provider is wrapped so one failure does not abort the rest; the result
  includes per-provider `status`, `startedAt`, `finishedAt`, `durationMs` and
  optional `error`, plus run-level `counts`/`durationMs` and a computed
  `overallStatus`.

A domain (`src/index.ts`) re-exports `MemoryGoogleSyncRepository` and the
`GoogleSyncRepository` / `SyncState` / `SyncStateStatus` types.

## Service facade

`GoogleIntegrationsService` is the single entry point for the API layer:

- `buildAuthorizationUrl(options)` — consent URL with PKCE and optional account
  override.
- `handleOAuthCallback(input)` — validates `state`, exchanges the code,
  resolves the account and persists the tokens, returning the provider account.
- `sync(input)` — runs `IncrementalSync` with `SyncRequestInput` (everything
  except `accessToken`; tokens are resolved from the credential manager).
- `listSites(storeId, account)` — convenience passthrough to
  `SearchConsoleClient`.

`GoogleIntegrationsServiceOptions` accepts an optional `now` clock (defaults to
`Date`), logger (`@seogod/logging`), `EventBus`, metrics registry and `fetch`
override — every integration is injectable for tests.

## Events and metrics

| Event | When |
| ----- | ---- |
| `google.oauth_completed` | the authorization code flow succeeds |
| `google.oauth_failed` | the authorization code flow fails |
| `google.sync_completed` | an incremental sync finishes |
| `google.sync_failed` | an incremental sync throws |

`EventBusPublisher` publishes these through the optional `EventBus`
(`@seogod/events`) as outbox-compatible messages; publish failures are logged,
never fatal.

`GoogleMetrics` records the `google_*` counters/histograms through the optional
`MetricsRegistry` (`@seogod/monitoring`) and degrades gracefully when none is
provided.

## Errors

All errors extend `GoogleError` (`@seogod/core` `AppError`):

- `GoogleValidationError` — invalid arguments/configuration.
- `GoogleAuthError` / `GoogleTokenError` / `GoogleInvalidStateError` — OAuth,
  token and state-verification failures.
- `GoogleApiError` / `GoogleRateLimitError` / `GoogleNetworkError` — API,
  rate-limit and transport failures.

## Usage

```ts
import {
  GoogleIntegrationsService,
  MemoryCredentialStorage,
  MemoryGoogleSyncRepository,
} from '@seogod/google-integrations';

const service = new GoogleIntegrationsService({
  credentialStorage: new MemoryCredentialStorage(),
  syncRepository: new MemoryGoogleSyncRepository(),
  oauthConfig: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!,
  },
});

// 1. start the consent flow (PKCE)
const url = await service.buildAuthorizationUrl({ storeId: 's1' });

// 2. handle the callback with the code + state
await service.handleOAuthCallback({ storeId: 's1', code, state, expectedState });

// 3. sync Search Console / GA4 / PageSpeed / Rich Results / Indexing
const result = await service.sync({ storeId: 's1', provider: 'search-console' });

// 4. read Google Search Console sites
const sites = await service.listSites('s1', 'me@example.com');
```

`@seogod/config` owns `process.env`; the client id/secret/redirect live in the
config package, not here.

## Testing

```bash
npm run test --workspace @seogod/google-integrations
npm run test:coverage --workspace @seogod/google-integrations
```

Coverage thresholds (95%) are enforced for lines, branches, functions and
statements. The suite covers OAuth (PKCE, state, userinfo, errors), credential
management (encryption, expiry-driven refresh), the HTTP client (query/header
building, retries, typed errors), every API client (happy paths, malformed and
normalized responses), incremental sync (cursors, idempotency, per-provider
failures), events, the repository and the service facade.

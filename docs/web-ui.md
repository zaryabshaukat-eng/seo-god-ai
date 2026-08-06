# Web UI

`@seogod/web` is the Web UI client for SEO GOD AI: a framework-free
TypeScript frontend that covers authentication, the dashboard, crawl
management, SEO analysis, execution management, observability dashboards,
reports, the AI Copilot chat, enterprise administration, settings,
notifications and real-time updates.

The package is intentionally dependency-light. Rendering uses a tiny
virtual-DOM helper (`h` / `renderToString`), state is plain observable
stores, and every feature view is a pure function of its model — so the
entire client is testable in a Node environment with no DOM and no browser
framework. It depends only on `@seogod/core` (error model) at runtime.

## Architecture

```
createWebApp(config)                        WebApp facade
  ├─ api            createApiClient          typed fetch client + error mapping
  ├─ auth           createAuthStore          session store + storage + login/register
  ├─ notifications  createNotificationsStore unread count, mark read
  ├─ theme          createThemeStore         light/dark/system pref
  ├─ ui             createUiStore            toasts + ephemeral UI state
  ├─ chat           createChatStore          Copilot streaming chat
  ├─ realtime       createRealtime           channel bus over an injected transport
  ├─ router         createRouter             RBAC-guarded navigation
  └─ nav            groupedNav/visibleRoutes permission-filtered navigation
```

`render()` composes the app shell (sidebar grouped by section, top bar with
theme toggle, notifications and sign out) around `renderRoute()`, which
dispatches to the per-feature page view-models. Anonymous users are served
the public auth pages; unauthorized navigation bounces to `/login`.

## Rendering and theming

- `h(tag, attrs, ...children)` builds a `VNode`; `renderToString` and
  `documentHtml` serialize to HTML with strict escaping (`escapeHtml`,
  `escapeAttr`) for text and attribute contexts. `flatten` handles nested
  children, and boolean attributes render bare (`checked`, `aria-disabled`).
- Design tokens live in `theme/tokens.ts` as light/dark palettes compiled to
  CSS custom properties (`resolveTokens`, `tokensToCss`). `luminance`,
  `contrastRatio`, `requiredContrast` and `verifyAccessiblePairs` assert WCAG
  contrast so every palette pair is accessible by construction.
- `theme/responsive.ts` maps breakpoints to a 12-column grid (`columnsFor`,
  `columnSpan`, `responsiveClass`) with a `MAX_CONTENT_WIDTH_PX` cap.

## Accessibility primitives

`ui/access.ts` and `ui/primitives.ts` ship the interactive primitives:

- `createFocusTrap` and `createRovingFocus` implement Escape/Tab trapping and
  arrow-key roving focus with wrap-around and clamped indices.
- `skipLink`, `liveRegion` (`role="status"`), `altTextFor` and `ariaCurrent`
  cover the remaining ARIA surface.
- `buttonEl`, `badgeEl`, `cardEl`, `spinnerEl`, `inputEl`, `selectEl`,
  `textareaEl`, `checkboxEl`, `tableEl`, `modalEl`, `toastEl` and `formEl`
  are the building blocks for every page, including the dialog/focus-trap
  modal and a `formEl` with field errors and an `aria-invalid` state.

## Routing and permissions

Routes live in `nav/routes.ts`; each application route declares the
`Permission` required to see it:

| Group | Routes |
| ----- | ------ |
| Overview | `/dashboard` (landing), `/observability` |
| Operations | `/crawls`, `/seo`, `/executions` |
| Intelligence | `/reports`, `/copilot` |
| Platform | `/admin`, `/settings` |

Public auth routes (`/login`, `/register`) sit outside the shell.
`visibleRoutes`, `groupedNav` and `landingRoute` derive the filtered
navigation from the session's permissions; `canAccessRoute` and the router
guards enforce them (`onUnauthorized` / `onForbidden` hooks).

Permissions mirror the `@seogod/enterprise` vocabulary (`dashboard.read`,
`crawl.write`, `seo.read`, `seo.write`, `execution.read/write`,
`observability.read`, `reports.read/write`, `copilot.read/write`,
`admin.read/write`, `settings.read/write`, `notifications.read`).

## State and real-time

- `createStore` (in `store.ts`) is the observable core: synchronous
  notifications with previous/next values, no-op update skipping, and a
  derived `select` store.
- Feature stores (`auth`, `notifications`, `theme`, `ui`, `chat`) wrap it
  with their domain logic; the auth store persists sessions to an injectable
  `AuthStorage` (memory or `localStorage`-style JSON).
- `createRealtime` subscribes to channels over an injected `RealtimeTransport`
  and reconnects with backoff. `connectRealtime()` wires the
  `notifications` and `alerts` channels into the notification store and UI
  toasts.

## API client

`api/client.ts` provides `createApiClient` with:

- JSON serialization, bearer-token injection, default headers and an abort
  signal/timeout (`DEFAULT_TIMEOUT_MS`),
- typed error mapping to the `WebError` hierarchy (`WebValidationError`,
  `WebAuthError`, `WebPermissionError`, `WebNetworkError`,
  `WebNotFoundError`, `WebConflictError`) with `onAuthError` notification,
- 204/empty-body handling and raw-text opt-out (`{ json: false }`).

`api/endpoints.ts` is the endpoint registry: every UI callable is declared
with method, path, auth requirement and permission. `endpointPath`
interpolates `:param` placeholders, and `createApiFunctions` in
`features/api-helpers.ts` wraps the client so feature APIs are one-liners.

## Feature pages

| Feature | Module | Highlights |
| ------- | ------ | ---------- |
| Auth | `features/auth.ts` | login/register/reset validation + page models |
| Dashboard | `features/dashboard.ts` | KPI cards, trend chart, quick actions, alerts |
| Crawls | `features/crawl.ts` | status tones, stats cards, start/cancel |
| SEO | `features/seo.ts` | severity ranking, filters, scoring, breakdown cards |
| Executions | `features/execution.ts` | status/risk tones, role-based actions, timeline |
| Observability | `features/observability.ts` | metric summaries, alerts table, timeline |
| Reports | `features/reports.ts` | report list, KPI sections, generation form |
| Copilot | `features/copilot.ts` | streaming chat, tool-call rendering, sessions |
| Enterprise | `features/enterprise.ts` | tenants, members, audit, API keys, webhooks, billing |
| Settings | `features/settings.ts` | profile + store settings forms, preferences |
| Notifications | `features/notifications.ts` | list, unread count, mark read |

Each feature exports a pure `render*Page` view-model plus validators and API
wrappers, so it can be tested in isolation.

## Usage

```ts
import { createWebApp } from '@seogod/web';

const app = createWebApp({ baseUrl: 'https://api.example.com' });

await app.submitLogin({ email: 'ada@example.com', password: 'password1', remember: false });
app.connectRealtime();
app.render(); // shell + current route as a VNode
```

## Testing

```bash
npm run test --workspace @seogod/web
npm run test:coverage --workspace @seogod/web
```

The suite covers the virtual DOM, escapes and rendering; accessibility
primitives; tokens/contrast and responsive layout; routes, guards and the
router; every store; the API client and endpoint registry; the real-time
bus; every feature page (including read-only and error branches); and the
full `createWebApp` integration (login/register/reset flows, anonymous
rendering, real-time wiring, theming). Coverage thresholds (95%) are
enforced for lines, branches, functions and statements; the suite reaches
100% statements/lines.

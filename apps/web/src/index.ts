/**
 * SEO GOD AI Web UI client.
 *
 * A framework-agnostic frontend for the platform: virtual-DOM rendering,
 * accessible component primitives, dark/light theming, responsive layout,
 * role-based routing, state stores, a real-time event bus, a typed API
 * client and per-feature view-models for every product area.
 */
export { packageName } from './package.js';

export { createWebApp, CHANNELS } from './app.js';
export type { WebApp, WebAppConfig } from './app.js';

export { createStore } from './store.js';
export type { Store, ReadableStore } from './store.js';

export { h, flatten, className, renderAttrs, renderNode, renderToString, documentHtml, escapeHtml, escapeAttr } from './vdom.js';

export {
  WebError,
  WebValidationError,
  WebAuthError,
  WebPermissionError,
  WebNetworkError,
  WebNotFoundError,
  WebConflictError,
  toWebError,
  fromApiError,
  errorMessage,
} from './errors.js';

export { createApiClient, DEFAULT_TIMEOUT_MS } from './api/client.js';
export type { ApiClient, ApiClientConfig, RequestOptions } from './api/client.js';
export {
  ENDPOINTS,
  Permissions,
  ALL_UI_PERMISSIONS,
  endpoint,
  endpointPermission,
  endpointAuth,
  endpointPath,
} from './api/endpoints.js';
export type { EndpointName, UiPermission } from './api/endpoints.js';
export { createRealtime } from './api/realtime.js';
export type { RealtimeClient, RealtimeConfig, RealtimeStatus } from './api/realtime.js';

export {
  createAuthStore,
  createAuthApi,
  createMemoryAuthStorage,
  createJsonAuthStorage,
} from './state/auth.js';
export type { AuthStore, AuthApi, AuthStorage, AuthState } from './state/auth.js';
export { createNotificationsStore, createNotificationsApi } from './state/notifications.js';
export type { NotificationsStore, NotificationsApi, NotificationsState } from './state/notifications.js';
export { createThemeStore, resolveTheme } from './state/theme.js';
export type { ThemeStore, ThemeStorage, ThemeState } from './state/theme.js';
export { createUiStore } from './state/ui.js';
export type { UiStore, UiState } from './state/ui.js';

export {
  LIGHT_TOKENS,
  DARK_TOKENS,
  TOKEN_THEMES,
  resolveTokens,
  tokensToCss,
  luminance,
  contrastRatio,
  requiredContrast,
  isAccessible,
  verifyAccessiblePairs,
  PREFERS_DARK_QUERY,
} from './theme/tokens.js';
export type { ThemeTokens } from './theme/tokens.js';
export {
  BREAKPOINTS,
  GUTTER_PX,
  MAX_CONTENT_WIDTH_PX,
  breakpointFor,
  breakpoint,
  matchesBreakpoint,
  columnsFor,
  columnSpan,
  responsiveClass,
} from './theme/responsive.js';
export type { Breakpoint, BreakpointName } from './theme/responsive.js';

export { ROUTES, AUTH_ROUTES, GROUP_ORDER, isPublicRoute, canAccessRoute, routeByPath, visibleRoutes, groupedNav, landingRoute } from './nav/routes.js';
export { createRouter } from './nav/router.js';
export type { Router, RouterConfig, RouterState } from './nav/router.js';

export { skipLink, liveRegion, createFocusTrap, createRovingFocus, altTextFor, ariaCurrent } from './ui/access.js';
export type { FocusTrap, RovingFocus } from './ui/access.js';
export {
  buttonEl,
  badgeEl,
  cardEl,
  spinnerEl,
  inputEl,
  selectEl,
  textareaEl,
  checkboxEl,
  tableEl,
  modalEl,
  toastEl,
  formEl,
} from './ui/primitives.js';
export type { ButtonVariant, BadgeTone, TableColumn, TableModel, ModalModel, FormModel } from './ui/primitives.js';
export { containerEl, gridEl, colEl, stackEl, navLinkEl, pageHeaderEl, appShellEl } from './ui/layout.js';
export type { ColSpans, NavLinkProps, PageHeaderProps, AppShellModel } from './ui/layout.js';

export {
  validateLoginForm,
  validateRegisterForm,
  validateResetForm,
  loginPageEl,
  registerPageEl,
  resetPageEl,
} from './features/auth.js';
export type { LoginPageModel, RegisterPageModel, ResetPageModel } from './features/auth.js';
export {
  formatNumber,
  changePct,
  trendChangePct,
  dashboardKpiCards,
  kpiCardEl as dashboardKpiCardEl,
  trendChartEl,
  quickActions,
  renderDashboardPage,
} from './features/dashboard.js';
export type { KpiCardModel, DashboardQuickAction, DashboardPageModel } from './features/dashboard.js';
export {
  validateStartCrawlInput,
  crawlStatusTone,
  crawlStats,
  renderCrawlsPage,
  renderCrawlDetailPage,
  createCrawlApi,
} from './features/crawl.js';
export {
  SEVERITY_ORDER,
  severityRank,
  filterRecommendations,
  sortRecommendations,
  scoreLabel,
  recommendationTone,
  explainRecommendation,
  breakdownCards,
  renderSeoPage,
  createSeoApi,
} from './features/seo.js';
export type { RecommendationFilters, SortKey, RecommendationExplanation } from './features/seo.js';
export {
  roleRank,
  executionStatusTone,
  canActOnExecution,
  buildExecutionTimeline,
  availableActions,
  renderExecutionsPage,
  renderExecutionDetailPage,
  createExecutionApi,
} from './features/execution.js';
export type { ExecutionActionModel } from './features/execution.js';
export {
  summarizeSeries,
  alertSeverityTone,
  timelineStatusTone,
  unacknowledgedAlerts,
  renderObservabilityPage,
  createObsApi,
} from './features/observability.js';
export type { MetricSummary } from './features/observability.js';
export {
  REPORT_KIND_LABELS,
  reportStatusTone,
  validateReportDraft,
  renderReportsPage,
  kpiListEl,
  renderReportDetailPage,
  createReportsApi,
} from './features/reports.js';
export type { ReportDraftErrors } from './features/reports.js';
export {
  validateChatInput,
  applyStreamEvent,
  createChatStore,
  createCopilotApi,
  messageClass,
  renderCopilotPage,
} from './features/copilot.js';
export type { CopilotApi, ChatStore, ChatState } from './features/copilot.js';
export {
  validateMemberInvite,
  roleTone,
  maskApiKey,
  buildRoleMatrix,
  renderTenantsPage,
  renderMembersPage,
  renderAuditPage,
  renderApiKeysPage,
  renderWebhooksPage,
  renderBillingPage,
  createAdminApi,
} from './features/enterprise.js';
export {
  validateProfileForm,
  validateStoreSettingsForm,
  profileFromUser,
  renderSettingsPage,
  createSettingsApi,
} from './features/settings.js';
export type { ProfileForm, StoreSettingsForm } from './features/settings.js';
export { notificationTone, unreadCount, renderNotificationsPage } from './features/notifications.js';
export { createApiFunctions } from './features/api-helpers.js';
export type { ApiFunctions } from './features/api-helpers.js';

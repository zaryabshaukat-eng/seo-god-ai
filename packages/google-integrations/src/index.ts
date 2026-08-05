export {
  GoogleError,
  GoogleApiError,
  GoogleAuthError,
  GoogleInvalidStateError,
  GoogleNetworkError,
  GoogleRateLimitError,
  GoogleTokenError,
  GoogleValidationError,
} from './errors.js';
export type { GoogleErrorCode, GoogleErrorContext } from './errors.js';

export {
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  GoogleOAuth,
} from './oauth.js';
export type { BuildAuthorizationUrlInput, GoogleOAuthConfig } from './oauth.js';

export {
  CredentialManager,
  EncryptedCredentialStorage,
  MemoryCredentialStorage,
  toStoredCredential,
} from './credentials.js';
export type {
  CredentialManagerOptions,
  CredentialStorage,
  EncryptedCredentialStorageOptions,
} from './credentials.js';

export { GoogleHttpClient } from './http-client.js';
export type { GoogleHttpClientOptions, GoogleRequestOptions } from './http-client.js';

export { GoogleMetrics, GOOGLE_METRICS_NAMES } from './metrics.js';

export {
  AnalyticsClient,
  IndexingClient,
  PageSpeedClient,
  RichResultsClient,
  SearchConsoleClient,
  SEARCH_CONSOLE_BASE_URL,
  ANALYTICS_BASE_URL,
  PAGESPEED_BASE_URL,
  RICH_RESULTS_BASE_URL,
  INDEXING_BASE_URL,
} from './clients.js';
export type {
  PageSpeedQuery,
  RichResultsRunTestInput,
  SearchConsoleSitemapSubmit,
} from './clients.js';

export { EventBusPublisher, GOOGLE_EVENT_TYPES } from './events.js';
export type { GoogleEventInput, GoogleEventPublisher, GoogleEventType } from './events.js';

export { MemoryGoogleSyncRepository } from './repository.js';
export type {
  GoogleSyncRepository,
  SyncState,
  SyncStateStatus,
} from './repository.js';
export { IncrementalSync } from './incremental-sync.js';
export type {
  SyncClients,
  SyncDependencies,
  SyncRequest,
  SyncRunResult,
} from './incremental-sync.js';

export {
  GoogleIntegrationsService,
  GOOGLE_PROFILE_SCOPES,
  DEFAULT_PROVIDER_SCOPES,
} from './service.js';
export type {
  BuildAuthorizationUrlInputOptions,
  GoogleIntegrationsServiceOptions,
  HandleOAuthCallbackInput,
  SyncRequestInput,
} from './service.js';

export type {
  Ga4DateRange,
  Ga4Dimension,
  Ga4Metric,
  Ga4RunReportQuery,
  Ga4RunReportResponse,
  Ga4Row,
  GoogleProvider,
  GoogleUserInfo,
  GscSite,
  IndexingNotification,
  IndexingNotificationResponse,
  IndexingNotificationType,
  OAuthTokenResult,
  PageSpeedAudit,
  PageSpeedMetrics,
  PageSpeedResult,
  PageSpeedStrategy,
  RichResultsItem,
  RichResultsRunTestResponse,
  RichResultsTestStatusResponse,
  SearchAnalyticsQuery,
  SearchAnalyticsResponse,
  SearchAnalyticsRow,
  SitemapEntry,
  StoredCredential,
} from './types.js';

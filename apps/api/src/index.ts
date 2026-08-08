/**
 * `@seogod/api` — public surface. Everything a host process needs to run the
 * SEO GOD AI API server: the platform composition root, the HTTP server, the
 * router, error model, context and the shared controllers.
 */

export { Platform, FakeDb, InMemoryDecisionReader, type PlatformOptions } from './platform.js';
export { ApiServer, createApiRouter, registerPlatformRoutes, type ApiServerOptions } from './server.js';
export { Router, requireRouteMatch, type RouteHandler, type RouteMatch } from './router.js';
export { createContext, bodyAs, type RequestContext, type Principal } from './context.js';
export {
  ApiError,
  ApiValidationError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  MethodNotAllowedError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  errorBody,
  toApiError,
  type ApiErrorOptions,
  type ErrorBody,
} from './errors.js';
export {
  applyCors,
  bearerToken,
  clientIp,
  methodOf,
  parseUrl,
  readJsonBody,
  sendBuffer,
  sendJson,
  sendNoContent,
  sendText,
} from './http.js';
export type { HttpMethod, HttpMethods } from './http.js';
export {
  guard,
  authenticate,
  userPrincipal,
  platformPermissionsFromScopes,
  type RouteOptions,
} from './guards.js';
export {
  PlatformPermissions,
  ALL_PLATFORM_PERMISSIONS,
  ROLE_PERMISSIONS,
  permissionsForRole,
  principalHasPermission,
  requirePlatformPermission,
  roleHasPermission,
  type PlatformPermission,
  type Role,
} from './permissions.js';
export {
  SlidingWindowRateLimiter,
  enforceLimit,
  type RateLimitDecision,
  type RateLimiterOptions,
} from './rate-limit.js';
export {
  optionalArray,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireEmail,
  requireEnum,
  requirePassword,
  requireString,
  validateAll,
  type FieldErrors,
  type Validator,
} from './validation.js';
export { AuthService, hashPassword, verifyPassword, type AuthSession, type UserRecord } from './auth.js';
export { NotificationsService, type Notification, type NotificationSeverity } from './notifications.js';
export { SettingsStore, type ProfilePreferences, type WorkspaceSettings } from './settings.js';
export {
  RealtimeHub,
  wireRealtimeToEventBus,
  registerRealtimeRoutes,
  type RealtimeEvent,
  type RealtimeHandler,
} from './realtime.js';
export { buildOpenApi, operationIdOf, registerOpenApiRoutes, type OpenApiDocument, type OpenApiSchema } from './openapi.js';
export { ApiClient, ApiRequestError, generateSdkSource, registerSdkRoutes, type ApiClientOptions, type ApiRequestOptions } from './sdk.js';

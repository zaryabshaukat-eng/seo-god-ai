/**
 * HTTP error model for the API server. Every failure is normalized into an
 * `ApiError` carrying an HTTP status, a stable machine-readable `code`, an
 * optional `context` object and a `retryable` flag (used by 429s and 5xx).
 */

import { PluginError, PluginErrorCode } from '@seogod/plugin-sdk';

export interface ApiErrorOptions {
  code?: string;
  context?: Record<string, unknown>;
  retryable?: boolean;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly context?: Record<string, unknown>;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(status: number, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = options.code ?? statusCodeToCode(status);
    this.context = options.context;
    this.retryable = options.retryable ?? (status >= 500 || status === 429);
    this.cause = options.cause;
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string, options: ApiErrorOptions = {}) {
    super(400, message, { ...options, code: options.code ?? 'bad_request' });
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Authentication is required.', options: ApiErrorOptions = {}) {
    super(401, message, { ...options, code: options.code ?? 'unauthorized' });
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'You are not allowed to perform this action.', options: ApiErrorOptions = {}) {
    super(403, message, { ...options, code: options.code ?? 'forbidden' });
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found.', options: ApiErrorOptions = {}) {
    super(404, message, { ...options, code: options.code ?? 'not_found' });
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'The resource conflicts with existing data.', options: ApiErrorOptions = {}) {
    super(409, message, { ...options, code: options.code ?? 'conflict' });
    this.name = 'ConflictError';
  }
}

export class ApiValidationError extends ApiError {
  readonly fields: Record<string, string>;

  constructor(message: string, fields: Record<string, string> = {}, options: ApiErrorOptions = {}) {
    super(400, message, { ...options, code: options.code ?? 'validation_error', context: { ...options.context, fields } });
    this.name = 'ApiValidationError';
    this.fields = fields;
  }
}

export class RateLimitError extends ApiError {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number, options: ApiErrorOptions = {}) {
    super(429, message, { ...options, code: options.code ?? 'rate_limited', retryable: true });
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class MethodNotAllowedError extends ApiError {
  constructor(message: string, options: ApiErrorOptions = {}) {
    super(405, message, { ...options, code: options.code ?? 'method_not_allowed' });
    this.name = 'MethodNotAllowedError';
  }
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    context?: Record<string, unknown>;
    retryable?: boolean;
  };
}

/** Renders an `ApiError` as the canonical JSON error body. */
export function errorBody(error: ApiError): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.context === undefined ? {} : { context: error.context }),
      retryable: error.retryable,
    },
  };
}

/** Maps a thrown value (ApiError, domain error, or anything else) to an `ApiError`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) {
    const mapped = mapKnownError(error);
    if (mapped !== null) return mapped;
    return new ApiError(500, error.message, { code: 'internal_error', cause: error });
  }
  return new ApiError(500, 'Internal server error.', { code: 'internal_error', cause: error });
}

function statusCodeToCode(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    default:
      return 'internal_error';
  }
}

/**
 * Maps domain errors from the `@seogod/*` packages onto HTTP semantics by
 * inspecting their error `name`. Domain errors follow a
 * `<Pkg><Kind>Error` convention, so the mapping is name-driven and decoupled.
 */
export function mapKnownError(error: Error): ApiError | null {
  if (error instanceof PluginError) {
    return mapPluginError(error);
  }
  const name = error.name;
  if (name.endsWith('AuthorizationError') || name.includes('Permission')) {
    return new ForbiddenError(error.message, { cause: error, context: errorContext(error) });
  }
  if (name.endsWith('IsolationError')) {
    return new ForbiddenError(error.message, { code: 'tenant_isolation', cause: error, context: errorContext(error) });
  }
  if (name.endsWith('NotFoundError') || name === 'NotFoundError') {
    return new NotFoundError(error.message, { cause: error, context: errorContext(error) });
  }
  if (name.endsWith('ConflictError') || name === 'ConflictError') {
    return new ConflictError(error.message, { cause: error, context: errorContext(error) });
  }
  if (name.endsWith('ValidationError') || name === 'ValidationError') {
    return new BadRequestError(error.message, { code: 'validation_error', cause: error, context: errorContext(error) });
  }
  if (name.includes('RateLimit') || name.endsWith('LimitError')) {
    return new RateLimitError(error.message, 1000, { cause: error, context: errorContext(error) });
  }
  return null;
}

interface ContextualError {
  context?: Record<string, unknown>;
}

function errorContext(error: Error): Record<string, unknown> | undefined {
  const contextual = error as Error & ContextualError;
  return typeof contextual.context === 'object' && contextual.context !== null ? contextual.context : undefined;
}

/** Maps plugin-SDK failures onto HTTP semantics keyed by stable code. */
export function mapPluginError(error: PluginError): ApiError {
  const context = typeof error.context === 'object' && error.context !== null ? { ...error.context } : undefined;
  switch (error.code) {
    case PluginErrorCode.notFound:
      return new NotFoundError(error.message, { code: 'plugin_not_found', cause: error, context });
    case PluginErrorCode.conflict:
    case PluginErrorCode.stateConflict:
      return new ConflictError(error.message, { code: 'plugin_conflict', cause: error, context });
    case PluginErrorCode.permissionNotGranted:
    case PluginErrorCode.permissionNotDeclared:
      return new ForbiddenError(error.message, { code: 'plugin_permission_denied', cause: error, context });
    case PluginErrorCode.sandboxTimeout:
    case PluginErrorCode.sandboxEval:
      return new BadRequestError(error.message, { code: 'plugin_execution_error', cause: error, context });
    default:
      return new BadRequestError(error.message, { code: 'plugin_error', cause: error, context });
  }
}

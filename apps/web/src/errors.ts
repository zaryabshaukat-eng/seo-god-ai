import { AppError, isAppError } from '@seogod/core';
import type { AppErrorOptions } from '@seogod/core';
import type { ApiErrorBody } from './types.js';

const MODULE = 'web';

/** Base error for the Web UI client. */
export class WebError extends AppError {
  constructor(message: string, options: AppErrorOptions) {
    super(message, { module: MODULE, ...options });
  }
}

/** Field/form validation failure on the client. */
export class WebValidationError extends WebError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: 'web.validation.error', context, operation: 'validation' });
  }
}

/** The user is not authenticated. */
export class WebAuthError extends WebError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: 'web.auth.error', context, operation: 'auth', retryable: false });
  }
}

/** The user lacks permission for an action or route. */
export class WebPermissionError extends WebError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: 'web.permission.error', context, operation: 'authorize' });
  }
}

/** Network/transport level failure. */
export class WebNetworkError extends WebError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'web.network.error', operation: 'transport', retryable: true, cause });
  }
}

/** A requested resource does not exist. */
export class WebNotFoundError extends WebError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: 'web.not_found.error', context, operation: 'read' });
  }
}

/** A conflicting state prevented the action. */
export class WebConflictError extends WebError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: 'web.conflict.error', context, operation: 'write' });
  }
}

/**
 * Normalizes an unknown failure into a WebError so UI code can render a safe
 * message. Preserves existing WebErrors and AppErrors.
 */
export function toWebError(error: unknown, fallback = 'Something went wrong. Please try again.'): WebError {
  if (error instanceof WebError) {
    return error;
  }
  if (isAppError(error)) {
    return new WebError(error.message, {
      code: error.code,
      context: error.context,
      retryable: error.retryable,
      cause: error,
    });
  }
  if (error instanceof Error) {
    return new WebNetworkError(error.message, error);
  }
  return new WebError(fallback, { code: 'web.unexpected.error', context: { value: error } });
}

/**
 * Builds a WebError from a normalized API error body plus the HTTP status,
 * matching status codes to the most specific client error type.
 */
export function fromApiError(status: number, body: ApiErrorBody): WebError {
  const message = body.message ?? `Request failed with status ${status}.`;
  const code = body.code ?? 'web.http.error';
  const context = { status, ...body.context };
  if (status === 401) {
    return new WebAuthError(message, { code, ...context });
  }
  if (status === 403) {
    return new WebPermissionError(message, { code, ...context });
  }
  if (status === 404) {
    return new WebNotFoundError(message, { code, ...context });
  }
  if (status === 409) {
    return new WebConflictError(message, { code, ...context });
  }
  if (status === 422 || status === 400) {
    return new WebValidationError(message, { code, ...context });
  }
  if (status >= 500) {
    return new WebError(message, { code, context, retryable: body.retryable });
  }
  return new WebError(message, { code, context });
}

/** Returns a human-readable message for a WebError. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Typed error hierarchy for all Google-integration failures.
 *
 * Every error extends the platform-wide {@link AppError} so loggers,
 * monitoring and the API layer handle failures uniformly, while keeping
 * Google-specific codes, context and metadata (HTTP status, retry hints).
 */

import { AppError } from '@seogod/core';
import type { GoogleProvider } from './types.js';

export type GoogleErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_STATE'
  | 'OAUTH_FAILED'
  | 'OAUTH_EXPIRED'
  | 'TOKEN_NOT_FOUND'
  | 'TOKEN_DECRYPTION_FAILED'
  | 'RATE_LIMITED'
  | 'API_ERROR'
  | 'NETWORK_ERROR';

export interface GoogleErrorContext {
  provider?: GoogleProvider;
  operation?: string;
  resource?: string;
  [key: string]: unknown;
}

interface GoogleErrorOptions {
  code: GoogleErrorCode;
  cause?: unknown;
  context?: GoogleErrorContext;
  requestId?: string;
  /**
   * Whether a retry is likely to succeed. Transient failures (rate limits,
   * 5xx, network blips) are `true`; permanent failures are `false`.
   */
  retryable?: boolean;
}

export class GoogleError extends AppError {
  declare readonly code: GoogleErrorCode;
  declare readonly context: GoogleErrorContext;

  constructor(message: string, options: GoogleErrorOptions) {
    super(message, {
      code: options.code,
      cause: options.cause,
      context: options.context,
      requestId: options.requestId,
      retryable: options.retryable,
    });
  }
}

export class GoogleValidationError extends GoogleError {
  constructor(message: string, context?: GoogleErrorContext) {
    super(message, { code: 'INVALID_ARGUMENT', context });
  }
}

export class GoogleAuthError extends GoogleError {
  constructor(message: string, context?: GoogleErrorContext, cause?: unknown) {
    super(message, { code: 'OAUTH_FAILED', context, cause });
  }
}

export class GoogleInvalidStateError extends GoogleError {
  constructor(message: string, context?: GoogleErrorContext) {
    super(message, { code: 'INVALID_STATE', context });
  }
}

export class GoogleTokenError extends GoogleError {
  constructor(
    message: string,
    code: 'TOKEN_NOT_FOUND' | 'TOKEN_DECRYPTION_FAILED' | 'OAUTH_EXPIRED',
    context?: GoogleErrorContext,
  ) {
    super(message, { code, context });
  }
}

export class GoogleRateLimitError extends GoogleError {
  readonly retryAfterSeconds?: number;

  constructor(message: string, context?: GoogleErrorContext, retryAfterSeconds?: number) {
    super(message, { code: 'RATE_LIMITED', context, retryable: true });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class GoogleApiError extends GoogleError {
  readonly status: number;
  readonly body?: string;

  constructor(
    message: string,
    options: {
      status: number;
      requestId?: string;
      body?: string;
      context?: GoogleErrorContext;
      cause?: unknown;
      retryable?: boolean;
    },
  ) {
    super(message, {
      code: 'API_ERROR',
      context: options.context,
      cause: options.cause,
      requestId: options.requestId,
      retryable: options.retryable,
    });
    this.status = options.status;
    this.body = options.body;
  }
}

export class GoogleNetworkError extends GoogleError {
  constructor(message: string, context?: GoogleErrorContext, cause?: unknown) {
    super(message, { code: 'NETWORK_ERROR', context, cause, retryable: true });
  }
}

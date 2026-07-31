/**
 * Typed error hierarchy for all Shopify-related failures.
 *
 * Every error extends the platform-wide {@link AppError} so loggers,
 * monitoring and the API layer can handle failures uniformly, while keeping
 * Shopify-specific codes, context and metadata (status codes, request ids,
 * retry hints).
 */

import { AppError } from '@seogod/core';

export type ShopifyErrorCode =
  | 'INVALID_STATE'
  | 'INVALID_SHOP_DOMAIN'
  | 'HMAC_MISMATCH'
  | 'OAUTH_FAILED'
  | 'TOKEN_NOT_FOUND'
  | 'TOKEN_DECRYPTION_FAILED'
  | 'RATE_LIMITED'
  | 'API_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_ARGUMENT';

export interface ShopifyErrorContext {
  shopDomain?: string;
  operation?: string;
  [key: string]: unknown;
}

interface ShopifyErrorOptions {
  code: ShopifyErrorCode;
  cause?: unknown;
  context?: ShopifyErrorContext;
  requestId?: string;
  /**
   * Whether a retry is likely to succeed. Transient failures (rate limits,
   * 5xx, network blips) are `true`; permanent failures are `false`.
   */
  retryable?: boolean;
}

export class ShopifyError extends AppError {
  declare readonly code: ShopifyErrorCode;
  declare readonly context: ShopifyErrorContext;

  constructor(message: string, options: ShopifyErrorOptions) {
    super(message, {
      code: options.code,
      cause: options.cause,
      context: options.context,
      requestId: options.requestId,
      retryable: options.retryable,
    });
  }
}

export class ShopifyValidationError extends ShopifyError {
  constructor(message: string, context?: ShopifyErrorContext) {
    super(message, { code: 'INVALID_ARGUMENT', context });
  }
}

export class ShopifyAuthError extends ShopifyError {
  constructor(message: string, context?: ShopifyErrorContext, cause?: unknown) {
    super(message, { code: 'OAUTH_FAILED', context, cause });
  }
}

export class ShopifyHmacError extends ShopifyError {
  constructor(message: string, context?: ShopifyErrorContext) {
    super(message, { code: 'HMAC_MISMATCH', context });
  }
}

export class ShopifyInvalidStateError extends ShopifyError {
  constructor(message: string, context?: ShopifyErrorContext) {
    super(message, { code: 'INVALID_STATE', context });
  }
}

export class ShopifyTokenError extends ShopifyError {
  constructor(
    message: string,
    code: 'TOKEN_NOT_FOUND' | 'TOKEN_DECRYPTION_FAILED',
    context?: ShopifyErrorContext,
  ) {
    super(message, { code, context });
  }
}

export class ShopifyRateLimitError extends ShopifyError {
  readonly retryAfterSeconds?: number;

  constructor(message: string, context?: ShopifyErrorContext, retryAfterSeconds?: number) {
    super(message, { code: 'RATE_LIMITED', context, retryable: true });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ShopifyApiError extends ShopifyError {
  readonly status: number;
  readonly body?: string;

  constructor(
    message: string,
    options: {
      status: number;
      requestId?: string;
      body?: string;
      context?: ShopifyErrorContext;
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

export class ShopifyNetworkError extends ShopifyError {
  constructor(message: string, context?: ShopifyErrorContext, cause?: unknown) {
    super(message, { code: 'NETWORK_ERROR', context, cause, retryable: true });
  }
}

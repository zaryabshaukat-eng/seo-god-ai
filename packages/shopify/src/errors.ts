/**
 * Typed error hierarchy for all Shopify-related failures.
 *
 * Every error carries structured `context` so callers and loggers can
 * attach agent, module, user, store and timestamp data without parsing
 * free-form messages.
 */

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
  /**
   * Whether a retry is likely to succeed. Transient failures (rate limits,
   * 5xx, network blips) are `true`; permanent failures are `false`.
   */
  retryable?: boolean;
}

export class ShopifyError extends Error {
  readonly code: ShopifyErrorCode;
  readonly context: ShopifyErrorContext;
  readonly timestamp: string;
  readonly retryable: boolean;

  constructor(message: string, options: ShopifyErrorOptions) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.context = options.context ?? {};
    this.timestamp = new Date().toISOString();
    this.retryable = options.retryable ?? false;
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
  readonly requestId?: string;
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
      retryable: options.retryable,
    });
    this.status = options.status;
    this.requestId = options.requestId;
    this.body = options.body;
  }
}

export class ShopifyNetworkError extends ShopifyError {
  constructor(message: string, context?: ShopifyErrorContext, cause?: unknown) {
    super(message, { code: 'NETWORK_ERROR', context, cause, retryable: true });
  }
}

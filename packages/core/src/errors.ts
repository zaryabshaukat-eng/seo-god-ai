import { AppError } from './app-error.js';
import type { AppErrorOptions } from './app-error.js';

/**
 * Canonical error codes. Use these instead of string literals everywhere.
 */
export const ErrorCodes = {
  domain: 'domain.error',
  validation: 'validation.error',
  authentication: 'authentication.failed',
  authorization: 'authorization.denied',
  notFound: 'not_found',
  conflict: 'conflict',
  network: 'network.error',
  rateLimit: 'rate_limit.exceeded',
  database: 'database.error',
  ai: 'ai.error',
  configuration: 'configuration.error',
  integration: 'integration.error',
  unexpected: 'unexpected.error',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Options for concrete error classes (the code is fixed per class). */
export type ErrorOptions = Omit<AppErrorOptions, 'code'>;

/** Generic domain/business rule violation. */
export class DomainError extends AppError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: ErrorCodes.domain });
  }
}

/** Input failed validation. Never retryable. */
export class ValidationError extends AppError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: ErrorCodes.validation });
  }
}

/** Authentication failed (bad credentials, expired session, invalid token). */
export class AuthenticationError extends AppError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: ErrorCodes.authentication });
  }
}

/** The actor is authenticated but not allowed to perform the action. */
export class AuthorizationError extends AppError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: ErrorCodes.authorization });
  }
}

/** The requested entity does not exist. */
export class NotFoundError extends AppError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: ErrorCodes.notFound });
  }
}

/** The operation conflicts with the current state (e.g. unique constraint). */
export class ConflictError extends AppError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: ErrorCodes.conflict });
  }
}

/** A network request failed. Retryable. */
export class NetworkError extends AppError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: ErrorCodes.network, retryable: true });
  }
}

/** An external API rate limit was hit. Retryable, may carry `retryAfterSeconds`. */
export class RateLimitError extends AppError {
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: ErrorOptions & { retryAfterSeconds?: number } = {}) {
    super(message, { ...options, code: ErrorCodes.rateLimit, retryable: true });
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** A persistence-layer failure (Postgres down, constraint violation, etc.). */
export class DatabaseError extends AppError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: ErrorCodes.database });
  }
}

/** An AI provider failed (timeout, malformed response, moderation refusal). */
export class AiError extends AppError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: ErrorCodes.ai });
  }
}

/** Invalid or missing configuration at startup. */
export class ConfigurationError extends AppError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: ErrorCodes.configuration });
  }
}

/** A third-party integration (Shopify, Google, etc.) failed. */
export class IntegrationError extends AppError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: ErrorCodes.integration });
  }
}

/** An unexpected, unrecovered failure. */
export class UnexpectedError extends AppError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: ErrorCodes.unexpected });
  }
}

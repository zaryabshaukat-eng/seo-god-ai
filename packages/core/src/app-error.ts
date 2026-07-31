/**
 * The single base error type for the whole platform.
 *
 * Every failure raised by any module (database, crawler, AI agents, API,
 * integrations) is an `AppError` subclass, so loggers, monitoring and the
 * API layer can handle errors uniformly: machine-readable `code`, structured
 * `context`, traceability (`operation`, `module`, `requestId`) and a
 * `retryable` flag for automation.
 */
export interface AppErrorOptions {
  /** Stable, machine-readable error code, e.g. `validation.error`. */
  code: string;
  /** Structured, serializable context for logs and API responses. */
  context?: Record<string, unknown>;
  /** The business operation that was running, e.g. `crawl.start`. */
  operation?: string;
  /** The module that raised the error, e.g. `shopify`, `crawler`. */
  module?: string;
  /** Correlation id of the request/run the error belongs to. */
  requestId?: string;
  /** True when retrying the operation is likely to succeed. */
  retryable?: boolean;
  /** The underlying error, if any. */
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly operation?: string;
  readonly module?: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly timestamp: string;

  constructor(message: string, options: AppErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    this.context = Object.freeze({ ...options.context });
    this.operation = options.operation;
    this.module = options.module;
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? false;
    this.timestamp = new Date().toISOString();
  }

  /** Safe, serializable representation (no stack, no cycles). */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      operation: this.operation,
      module: this.module,
      requestId: this.requestId,
      retryable: this.retryable,
      timestamp: this.timestamp,
    };
  }
}

/** Type guard for catching unknown errors and normalizing them. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

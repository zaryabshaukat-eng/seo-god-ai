import pino from 'pino';

export type Logger = pino.Logger;
export type LogDestination = pino.DestinationStream;
import { isAppError } from '@seogod/core';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface LoggerOptions {
  /** Logger name, shown in every line (e.g. `crawler`, `api`). */
  name?: string;
  /** Minimum level to emit. Defaults to `info`. */
  level?: LogLevel;
  /** Runtime environment, attached to every line as `nodeEnv`. */
  nodeEnv?: string;
  /** Redact secrets from logged objects. Defaults to `true`. */
  redact?: boolean;
}

/**
 * Property paths that are redacted (with wildcards) wherever they appear in
 * a logged object: tokens, keys, secrets, passwords and Authorization headers.
 */
export const REDACT_PATHS = [
  'authorization',
  'req.headers.authorization',
  '*.apiKey',
  '*.apiSecret',
  '*.accessToken',
  '*.refreshToken',
  '*.token',
  '*.secret',
  '*.password',
  'token',
  'apiKey',
  'apiSecret',
  'accessToken',
  'secret',
  'password',
  'SHOPIFY_ADMIN_ACCESS_TOKEN',
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET',
  'SHOPIFY_TOKEN_ENCRYPTION_KEY',
  'AI_API_KEY',
] as const;

/**
 * Serializes any value into a log-safe object. `AppError`s surface their
 * `code`, `context`, `module`, `operation`, `requestId` and `retryable`
 * fields; plain errors surface `type`, `message` and `stack`.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const serialized: Record<string, unknown> = {
      type: err.name,
      message: err.message,
    };
    if (err.stack !== undefined) serialized.stack = err.stack;
    if (isAppError(err)) {
      serialized.code = err.code;
      serialized.context = err.context;
      serialized.module = err.module;
      serialized.operation = err.operation;
      serialized.requestId = err.requestId;
      serialized.retryable = err.retryable;
    }
    if (err.cause !== undefined) serialized.cause = serializeError(err.cause);
    return serialized;
  }
  return { type: 'non-error', value: err };
}

/**
 * Builds a Pino logger. Output is always newline-delimited JSON so logs can
 * be piped to any collector (Loki, CloudWatch, pino-pretty in dev).
 */
export function createLogger(
  options: LoggerOptions = {},
  destination?: LogDestination,
): Logger {
  const { name, level = 'info', nodeEnv = 'development', redact = true } = options;
  return pino(
    {
      name,
      level,
      base: { nodeEnv },
      serializers: { err: serializeError },
      redact: redact ? { paths: [...REDACT_PATHS], censor: '[REDACTED]' } : undefined,
    },
    destination,
  );
}

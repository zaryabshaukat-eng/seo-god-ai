import { ConfigurationError } from '@seogod/core';
import { configSchema, type Config } from './env.js';

let cached: Config | undefined;

/**
 * Parses and validates a raw environment surface. Throws
 * {@link ConfigurationError} describing every invalid variable. The only
 * place in the platform allowed to read `process.env`.
 */
export function loadConfig(source: Record<string, unknown> = process.env): Config {
  const result = configSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigurationError('Invalid or missing environment configuration', {
      module: 'config',
      context: {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }
  return result.data;
}

/** Cached, process-wide config singleton. Call once at boot. */
export function getConfig(source: Record<string, unknown> = process.env): Config {
  cached ??= loadConfig(source);
  return cached;
}

/** Clears the cached singleton (used by tests and hot reload). */
export function resetConfig(): void {
  cached = undefined;
}

import { getConfig } from '@seogod/config';
import { createLogger, type Logger, type LoggerOptions } from './logger.js';

let cached: Logger | undefined;

/**
 * The process-wide default logger, configured from the environment via
 * {@link getConfig}. Use `createLogger` for explicit/child loggers.
 */
export function getLogger(options: LoggerOptions = {}): Logger {
  if (cached !== undefined) return cached;
  const config = getConfig();
  cached = createLogger({
    name: options.name ?? 'seogod',
    level: options.level ?? config.app.logLevel,
    nodeEnv: config.app.nodeEnv,
  });
  return cached;
}

/** Clears the cached singleton (used by tests and hot reload). */
export function resetLogger(): void {
  cached = undefined;
}

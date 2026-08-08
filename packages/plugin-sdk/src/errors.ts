/**
 * Plugin SDK error model. A single `PluginError` carries a machine-readable
 * code and structured context so the API layer can map failures to HTTP
 * statuses and operators can audit plugin problems.
 */

export const PluginErrorCode = {
  invalidManifest: 'plugin.manifest.invalid',
  invalidVersion: 'plugin.version.invalid',
  invalidCode: 'plugin.code.invalid',
  sandboxTimeout: 'plugin.sandbox.timeout',
  sandboxEval: 'plugin.sandbox.eval_failed',
  permissionNotGranted: 'plugin.permission.not_granted',
  permissionNotDeclared: 'plugin.permission.not_declared',
  notFound: 'plugin.not_found',
  conflict: 'plugin.conflict',
  stateConflict: 'plugin.state.invalid',
  dependencyUnsatisfied: 'plugin.dependency.unsatisfied',
  engineUnsatisfied: 'plugin.engine.unsatisfied',
  missingImplementation: 'plugin.contribution.missing_impl',
  invalidOutput: 'plugin.contribution.invalid_output',
} as const;

export type PluginErrorCodeValue = (typeof PluginErrorCode)[keyof typeof PluginErrorCode];

export interface PluginErrorOptions {
  context?: Record<string, unknown>;
  cause?: unknown;
}

/** Base error for every plugin-SDK failure. */
export class PluginError extends Error {
  readonly code: PluginErrorCodeValue;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: PluginErrorCodeValue, message: string, options: PluginErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.context = Object.freeze({ ...options.context });
  }

  /** Safe, serializable representation for logs and API responses. */
  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, message: this.message, context: this.context };
  }
}

/** Type guard for normalizing thrown values. */
export function isPluginError(value: unknown): value is PluginError {
  return value instanceof PluginError;
}

/** Extracts a `PluginError` from any thrown value, if possible. */
export function asPluginError(value: unknown): PluginError | null {
  return isPluginError(value) ? value : null;
}

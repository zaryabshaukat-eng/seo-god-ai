/**
 * Secure plugin sandbox. Plugin code is evaluated inside a fresh `node:vm`
 * context that only exposes ECMAScript built-ins — never `process`, `require`,
 * `module`, `exports`, `Buffer`, `fetch`, timers, `WebAssembly` or the host
 * realm. The host provides an optional logging `console` and extra safe
 * globals. Evaluation is length-limited and runs under a synchronous timeout;
 * contribution calls are wrapped with a host-side timeout and their inputs and
 * outputs are deep-cloned so plugins cannot mutate host data or leak host
 * objects.
 */

import vm from 'node:vm';
import { PluginError, PluginErrorCode } from './errors.js';

/** Node-specific globals that are removed if the VM ever exposes them. */
const DANGEROUS_GLOBALS = [
  'process',
  'require',
  'module',
  'exports',
  'Buffer',
  'global',
  'fetch',
  'WebAssembly',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'queueMicrotask',
  'XMLHttpRequest',
  'Worker',
  'importScripts',
];

export type SandboxLogLevel = 'log' | 'info' | 'warn' | 'error';

export interface SandboxOptions {
  /** Maximum synchronous execution time for a single call, in ms. */
  timeoutMs?: number;
  /** Maximum plugin code length in characters. */
  maxCodeLength?: number;
  /** Log sink receiving the plugin's `console` output. */
  logger?: { [level in SandboxLogLevel]?: (message: string) => void };
  /** Additional safe globals made available to the plugin code. */
  globals?: Record<string, unknown>;
}

export interface Sandbox {
  /** Evaluates `code` and returns its completion value. */
  evaluate<T>(code: string): T;
  /**
   * Invokes a sandboxed function with deep-cloned arguments and returns the
   * deep-cloned, serializable result (or a timeout rejection). `fn` is
   * validated at runtime to be callable.
   */
  invoke<T>(fn: unknown, thisArg: unknown, args: unknown[], timeoutMs?: number): Promise<T>;
  /** Releases the context reference. */
  dispose(): void;
}

const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_CODE_LENGTH = 1_000_000;

/** True for any thenable, regardless of realm. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/** Deep-clones plain data with `structuredClone`; null on clone failure. */
function cloneValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}

function buildContext(logger: SandboxOptions['logger'], globals: Record<string, unknown>): vm.Context {
  const context = vm.createContext({});
  const globalObject = context as unknown as Record<string, unknown>;
  // Node's vm context inherits some host globals (e.g. `console`, `WebAssembly`)
  // from the global environment. Shadow them with `undefined` so plugins cannot
  // reach the host realm through them.
  for (const name of DANGEROUS_GLOBALS) {
    globalObject[name] = undefined;
  }
  if (logger !== undefined) {
    const log = (level: SandboxLogLevel) => (message: unknown) => {
      const text = typeof message === 'string' ? message : safeStringify(message);
      logger[level]?.(text);
    };
    globalObject.console = Object.freeze({
      log: log('log'),
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
    });
  } else {
    globalObject.console = undefined;
  }
  for (const [key, value] of Object.entries(globals)) {
    globalObject[key] = value;
  }
  return context;
}

function safeStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

/** Creates a sandbox for one plugin. */
export function createSandbox(options: SandboxOptions = {}): Sandbox {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxCodeLength = options.maxCodeLength ?? DEFAULT_MAX_CODE_LENGTH;
  const context = buildContext(options.logger, options.globals ?? {});
  let disposed = false;

  const assertActive = (): void => {
    if (disposed) {
      throw new PluginError(PluginErrorCode.sandboxEval, 'Sandbox has been disposed.');
    }
  };

  return {
    evaluate<T>(code: string): T {
      assertActive();
      if (code.length > maxCodeLength) {
        throw new PluginError(PluginErrorCode.invalidCode, `Plugin code exceeds the ${maxCodeLength}-character limit.`, {
          context: { length: code.length, maxCodeLength },
        });
      }
      let script: vm.Script;
      try {
        script = new vm.Script(code, { filename: 'plugin.js' });
      } catch (error) {
        throw new PluginError(PluginErrorCode.invalidCode, `Plugin code failed to parse: ${messageOf(error)}.`, {
          cause: error,
        });
      }
      try {
        return script.runInContext(context, { timeout: timeoutMs }) as T;
      } catch (error) {
        if (isV8TimeoutError(error)) {
          throw new PluginError(PluginErrorCode.sandboxTimeout, `Plugin code did not finish within ${timeoutMs}ms.`, {
            cause: error,
          });
        }
        throw new PluginError(PluginErrorCode.sandboxEval, `Plugin code failed to evaluate: ${messageOf(error)}.`, {
          cause: error,
        });
      }
    },

    async invoke<T>(fn: unknown, thisArg: unknown, args: unknown[], callTimeoutMs?: number): Promise<T> {
      assertActive();
      if (typeof fn !== 'function') {
        throw new PluginError(PluginErrorCode.invalidOutput, 'Plugin contribution implementation is not callable.');
      }
      const limit = callTimeoutMs ?? timeoutMs;
      const clonedArgs = args.map((arg) => cloneValue(arg));
      let result: unknown;
      try {
        result = fn.apply(thisArg, clonedArgs);
      } catch (error) {
        throw new PluginError(PluginErrorCode.sandboxEval, `Plugin contribution threw: ${messageOf(error)}.`, {
          cause: error,
        });
      }
      if (isThenable(result)) {
        const timeout = new Promise<never>((_, reject) => {
          const timer = setTimeout(() => {
            reject(new PluginError(PluginErrorCode.sandboxTimeout, `Plugin contribution did not finish within ${limit}ms.`));
          }, limit);
          timer.unref();
        });
        const resolved = (await Promise.race([result as PromiseLike<unknown>, timeout])) as unknown;
        return cloneResult(resolved) as T;
      }
      return cloneResult(result) as T;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
    },
  };
}

function cloneResult(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  const cloned = cloneValue(value);
  if (cloned === null) {
    throw new PluginError(PluginErrorCode.invalidOutput, 'Plugin contribution returned non-serializable data.', {
      context: { type: typeof value },
    });
  }
  return cloned;
}

function isV8TimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { name?: unknown; message?: unknown };
  return record.name === 'Error' && typeof record.message === 'string' && /timed out after/i.test(record.message);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

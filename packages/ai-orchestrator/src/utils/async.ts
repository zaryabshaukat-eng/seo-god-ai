import { CancelledError, TimeoutError } from '../errors.js';

function aborted(): CancelledError {
  return new CancelledError('operation was cancelled');
}

/**
 * Resolves the promise or rejects with {@link TimeoutError} after `ms`
 * (skipped when `ms` <= 0) or with {@link CancelledError} when `signal`
 * aborts. The internal timer is always cleared on settle.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal !== undefined && signal.aborted) {
      reject(aborted());
      return;
    }
    let settled = false;
    const timer =
      ms > 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new TimeoutError(`operation timed out after ${ms}ms`));
          }, ms)
        : null;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      reject(aborted());
    };
    if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true });
    const cleanup = (): void => {
      if (timer !== null) clearTimeout(timer);
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
    };
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

/** True when the signal was aborted. */
export function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false;
}

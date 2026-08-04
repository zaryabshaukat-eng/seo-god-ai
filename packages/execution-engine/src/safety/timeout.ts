import { ExecutionTimeoutError } from '../utils/errors.js';

export type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Rejects `promise` when it does not settle within `ms`. Non-positive or
 * non-finite timeouts run the promise without a timer.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer: TimerHandle | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new ExecutionTimeoutError(`${label} timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

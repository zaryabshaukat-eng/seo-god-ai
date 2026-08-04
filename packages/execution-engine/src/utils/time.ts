/** Sleep helper; injectable so deterministic tests can avoid real timers. */
export type SleepFn = (ms: number) => Promise<void>;

export const realSleep: SleepFn = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Exponential backoff in ms for attempt `attemptNumber` (1-based). */
export function backoffDelay(attemptNumber: number, baseMs: number, maxMs: number): number {
  const safeBase = baseMs > 0 ? baseMs : 1;
  const exponent = Math.max(0, attemptNumber - 1);
  const factor = 2 ** exponent;
  return Math.min(Math.max(1, safeBase * factor), maxMs);
}

/** Epoch ms for `delayMs` from now, clamped to a minimum of 0. */
export function availableAt(delayMs: number, nowMs: number): number {
  return nowMs + Math.max(0, delayMs);
}

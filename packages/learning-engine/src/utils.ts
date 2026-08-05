/**
 * Small deterministic helpers shared across the learning engine. The numeric
 * helpers mirror the decision engine's `@seogod/decision-engine` utilities so
 * learned scores and effectiveness stay consistent with prioritization.
 */

/** Clamps a value into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Average of a number array; 0 when empty. */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Normalizes a positive count against a reference maximum on a curve that
 * flattens as counts grow: value = 1 - 1/(1 + count/ref).
 */
export function reachFactor(count: number, reference: number): number {
  if (count <= 0 || reference <= 0) return 0;
  return 1 - 1 / (1 + count / reference);
}

/**
 * Bayesian-smoothed success rate: pulls small samples toward a default so one
 * lucky attempt never dominates the signal.
 */
export function smoothedRate(attempts: number, successes: number, defaultRate: number): number {
  if (attempts <= 0) return defaultRate;
  const pseudoCount = 2;
  return (successes + defaultRate * pseudoCount) / (attempts + pseudoCount);
}

/** Branch-free record id: unique enough for in-memory and test stores. */
export function newLearningId(seed: string): string {
  return `lrn_${seed}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Newest `createdAt` across records; `undefined` when there are none. */
export function latestCreatedAt(records: ReadonlyArray<{ createdAt: string }>): string | undefined {
  let latest: string | undefined;
  for (const record of records) {
    if (latest === undefined || record.createdAt > latest) {
      latest = record.createdAt;
    }
  }
  return latest;
}

/** First defined `storeId` across records; `undefined` when there is none. */
export function firstDefinedStoreId(records: ReadonlyArray<{ storeId?: string }>): string | undefined {
  for (const record of records) {
    if (record.storeId !== undefined) return record.storeId;
  }
  return undefined;
}

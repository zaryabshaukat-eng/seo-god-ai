/**
 * Small deterministic numeric helpers shared by scoring, prioritization, and
 * risk assessment. All functions are pure and total.
 */

/** Clamps a value into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Weighted sum of factors; weights may be partial (missing = 0). */
export function weightedSum(
  factors: Record<string, number>,
  weights: Record<string, number>,
): number {
  let total = 0;
  for (const [key, value] of Object.entries(factors)) {
    total += (weights[key] ?? 0) * value;
  }
  return total;
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

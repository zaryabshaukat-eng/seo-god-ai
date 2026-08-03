/**
 * Cost estimation from token usage. Pricing is per-model USD-per-1k-tokens
 * and falls back to a conservative default when the model is unknown so the
 * orchestrator never silently reports zero cost.
 */

export const MODEL_PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'gpt-4o': { inputPer1k: 0.0025, outputPer1k: 0.01 },
  'gpt-4.1-mini': { inputPer1k: 0.0004, outputPer1k: 0.0016 },
  'gpt-4.1': { inputPer1k: 0.002, outputPer1k: 0.008 },
  'gpt-4.1-nano': { inputPer1k: 0.0001, outputPer1k: 0.0004 },
  'claude-3-5-sonnet': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-3-haiku': { inputPer1k: 0.00025, outputPer1k: 0.00125 },
  'gemini-1.5-pro': { inputPer1k: 0.00125, outputPer1k: 0.005 },
  'gemini-1.5-flash': { inputPer1k: 0.000075, outputPer1k: 0.0003 },
};

/** Default pricing for models without an explicit entry (conservative). */
export const DEFAULT_PRICING = { inputPer1k: 0.0004, outputPer1k: 0.0016 };

/** Rounds to 6 decimals so tiny costs stay stable across runs. */
export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const cost =
    (promptTokens / 1000) * pricing.inputPer1k + (completionTokens / 1000) * pricing.outputPer1k;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICING, estimateCost, MODEL_PRICING } from './cost.js';

describe('cost estimation', () => {
  it('computes known-model pricing from token usage', () => {
    const cost = estimateCost('gpt-4o-mini', 1000, 1000);
    const expected =
      (1000 / 1000) * MODEL_PRICING['gpt-4o-mini']!.inputPer1k +
      (1000 / 1000) * MODEL_PRICING['gpt-4o-mini']!.outputPer1k;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it('falls back to the conservative default for unknown models', () => {
    const cost = estimateCost('unknown-model', 1000, 1000);
    expect(cost).toBeCloseTo(DEFAULT_PRICING.inputPer1k + DEFAULT_PRICING.outputPer1k, 6);
  });

  it('returns zero for zero tokens and rounds to 6 decimals', () => {
    expect(estimateCost('gpt-4o-mini', 0, 0)).toBe(0);
    expect(estimateCost('gpt-4o', 3333, 3333)).toBeCloseTo(
      (3333 / 1000) * 0.0025 + (3333 / 1000) * 0.01,
      4,
    );
  });

  it('exposes pricing for common models', () => {
    expect(MODEL_PRICING['claude-3-5-sonnet']).toBeDefined();
    expect(MODEL_PRICING['gemini-1.5-flash']).toBeDefined();
  });
});

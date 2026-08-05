import { describe, expect, it } from 'vitest';
import { ScoreValidationError } from './errors.js';
import { RecommendationScorer } from './scoring.js';
import type { ScorerWeights } from './scoring.js';
import { InMemoryLearningStore } from './store.js';
import type { FeedbackRecord, OutcomeInput } from './types.js';

async function seedOutcomes(store: InMemoryLearningStore, inputs: OutcomeInput[]): Promise<void> {
  for (const [index, input] of inputs.entries()) {
    await store.saveOutcome({
      ...input,
      id: `o${index}`,
      createdAt: input.createdAt ?? '2024-01-01T00:00:00.000Z',
    });
  }
}

async function seedFeedback(store: InMemoryLearningStore, inputs: FeedbackRecord[]): Promise<void> {
  for (const input of inputs) {
    await store.saveFeedback(input);
  }
}

describe('RecommendationScorer', () => {
  it('throws when any factor is non-finite', async () => {
    const scorer = new RecommendationScorer(new InMemoryLearningStore());
    await expect(
      scorer.score({ rule: 'r1', confidence: Number.NaN, impact: 0.5, effort: 0.5 }),
    ).rejects.toBeInstanceOf(ScoreValidationError);
    await expect(
      scorer.score({ rule: 'r1', confidence: 0.5, impact: Number.NaN, effort: 0.5 }),
    ).rejects.toBeInstanceOf(ScoreValidationError);
    await expect(
      scorer.score({ rule: 'r1', confidence: 0.5, impact: 0.5, effort: Number.NaN }),
    ).rejects.toBeInstanceOf(ScoreValidationError);
  });

  it('scores with defaults when there is no history', async () => {
    const scorer = new RecommendationScorer(new InMemoryLearningStore());
    const result = await scorer.score({
      rule: 'r1',
      confidence: 0.8,
      impact: 1,
      effort: 0.5,
      pageCount: 10,
    });
    expect(result.rule).toBe('r1');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown.historicalEffectiveness).toBe(0.5);
    expect(result.breakdown.feedback).toBe(0.5);
    expect(result.breakdown.calibratedConfidence).toBeCloseTo(0.8);
  });

  it('boosts score with strong history and positive feedback', async () => {
    const store = new InMemoryLearningStore();
    await seedOutcomes(store, [
      { executionId: 'e1', storeId: 's1', rule: 'r1', status: 'SUCCESS', confidence: 0.9, durationMs: 100 },
      { executionId: 'e2', storeId: 's1', rule: 'r1', status: 'SUCCESS', confidence: 0.9, durationMs: 200 },
    ]);
    await seedFeedback(store, [
      { id: 'f1', storeId: 's1', rule: 'r1', rating: 1, createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 'f2', storeId: 's1', rule: 'r1', rating: 1, createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    const scorer = new RecommendationScorer(store);
    const result = await scorer.score({
      rule: 'r1',
      confidence: 0.9,
      impact: 1,
      effort: 0.9,
      pageCount: 50,
    });
    expect(result.breakdown.historicalEffectiveness).toBeGreaterThan(0.5);
    expect(result.breakdown.feedback).toBe(1);
    expect(result.breakdown.calibratedConfidence).toBe(1);
  });

  it('reduces score with failed history and negative feedback', async () => {
    const store = new InMemoryLearningStore();
    await seedOutcomes(store, [
      { executionId: 'e1', storeId: 's1', rule: 'r1', status: 'FAILURE', confidence: 0.2 },
    ]);
    await seedFeedback(store, [
      { id: 'f1', storeId: 's1', rule: 'r1', rating: -1, createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    const scorer = new RecommendationScorer(store);
    const result = await scorer.score({ rule: 'r1', confidence: 0.2, impact: 0, effort: 0, pageCount: 0 });
    expect(result.breakdown.historicalEffectiveness).toBeLessThan(0.5);
    expect(result.breakdown.feedback).toBe(0);
    expect(result.breakdown.calibratedConfidence).toBe(0);
    expect(result.breakdown.reach).toBe(0);
  });

  it('honours custom weights and explicit page factors', async () => {
    const store = new InMemoryLearningStore();
    const scorer = new RecommendationScorer(store);
    const weights: ScorerWeights = {
      impact: 1,
      calibratedConfidence: 0,
      historicalEffectiveness: 0,
      reach: 0,
      effort: 0,
      feedback: 0,
    };
    const result = await scorer.score(
      { rule: 'r1', confidence: 0.5, impact: 0.5, effort: 0.5, pageCount: 10, maxReachPages: 10 },
      weights,
    );
    expect(result.score).toBe(50);
    expect(result.breakdown.reach).toBeCloseTo(0.5);
  });
});

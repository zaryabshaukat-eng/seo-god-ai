import { describe, expect, it } from 'vitest';
import { SignalGenerator } from './signals.js';
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

describe('SignalGenerator', () => {
  it('derives outcome signals with positive, negative and neutral kinds', async () => {
    const store = new InMemoryLearningStore();
    await seedOutcomes(store, [
      { executionId: 'e1', storeId: 's1', rule: 'good', status: 'SUCCESS' },
      { executionId: 'e2', storeId: 's1', rule: 'good', status: 'SUCCESS' },
      { executionId: 'e3', storeId: 's1', rule: 'good', status: 'SUCCESS' },
      { executionId: 'e4', storeId: 's1', rule: 'good', status: 'FAILURE' },
      { executionId: 'e5', storeId: 's1', rule: 'bad', status: 'FAILURE' },
      { executionId: 'e6', storeId: 's1', rule: 'bad', status: 'FAILURE' },
      { executionId: 'e7', storeId: 's1', rule: 'bad', status: 'SUCCESS' },
      { executionId: 'e8', storeId: 's1', rule: 'mid', status: 'SUCCESS' },
      { executionId: 'e9', storeId: 's1', rule: 'mid', status: 'FAILURE' },
    ]);

    const result = await new SignalGenerator(store).generate();
    expect(result.signals).toHaveLength(3);
    const byRule = new Map(result.signals.map((signal) => [signal.rule, signal]));
    expect(byRule.get('good')?.kind).toBe('positive');
    expect(byRule.get('bad')?.kind).toBe('negative');
    expect(byRule.get('mid')?.kind).toBe('neutral');
  });

  it('derives feedback signals and honours custom options', async () => {
    const store = new InMemoryLearningStore();
    await seedFeedback(store, [
      { id: 'f1', storeId: 's1', rule: 'r1', rating: 1, createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 'f2', storeId: 's1', rule: 'r1', rating: 1, createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 'f3', storeId: 's1', rule: 'r1', rating: -1, createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    const at = '2024-01-01T00:00:00.000Z';
    const result = await new SignalGenerator(store).generate({
      storeId: 's1',
      minSamples: 2,
      now: () => at,
    });
    expect(result.generatedAt).toBe(at);
    expect(result.signals).toHaveLength(1);
    const signal = result.signals[0];
    expect(signal?.source).toBe('feedback');
    expect(signal?.kind).toBe('positive');
    expect(signal?.timestamp).toBe(at);
    expect(signal?.confidence).toBeCloseTo(3 / 5);
  });

  it('groups feedback and outcomes that have no rule', async () => {
    const store = new InMemoryLearningStore();
    await seedFeedback(store, [
      { id: 'f1', storeId: 's1', rating: 1, createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    await seedOutcomes(store, [{ executionId: 'e1', storeId: 's1', status: 'SUCCESS' }]);
    const result = await new SignalGenerator(store).generate();
    const rules = result.signals.map((signal) => signal.rule).sort();
    expect(rules).toContain('feedback');
    expect(rules).toContain('unknown');
  });

  it('is empty when there is no data', async () => {
    const store = new InMemoryLearningStore();
    const result = await new SignalGenerator(store).generate();
    expect(result.signals).toEqual([]);
    expect(result.generatedAt).toBeDefined();
  });
});

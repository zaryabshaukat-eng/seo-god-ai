import { describe, expect, it } from 'vitest';
import { OutcomeAnalyzer } from './analysis.js';
import { InMemoryLearningStore } from './store.js';
import type { OutcomeInput } from './types.js';

async function seedOutcomes(store: InMemoryLearningStore, inputs: OutcomeInput[]): Promise<void> {
  for (const [index, input] of inputs.entries()) {
    await store.saveOutcome({
      ...input,
      id: `o${index}`,
      createdAt: input.createdAt ?? '2024-01-01T00:00:00.000Z',
    });
  }
}

describe('OutcomeAnalyzer', () => {
  it('groups outcomes by rule and computes performance', async () => {
    const store = new InMemoryLearningStore();
    await seedOutcomes(store, [
      { executionId: 'e1', storeId: 's1', rule: 'r1', status: 'SUCCESS', impact: 10, durationMs: 100, createdAt: '2024-01-01T00:00:00.000Z' },
      { executionId: 'e2', storeId: 's1', rule: 'r1', status: 'SUCCESS', impact: 20, durationMs: 200, createdAt: '2024-01-02T00:00:00.000Z' },
      { executionId: 'e3', storeId: 's1', rule: 'r1', status: 'FAILURE', createdAt: '2024-01-03T00:00:00.000Z' },
      { executionId: 'e4', storeId: 's1', rule: 'r1', status: 'ROLLED_BACK', createdAt: '2024-01-04T00:00:00.000Z' },
      { executionId: 'e5', storeId: 's1', rule: 'r1', status: 'SKIPPED', createdAt: '2024-01-05T00:00:00.000Z' },
    ]);

    const { rules, summary } = await new OutcomeAnalyzer(store).analyze();
    expect(summary.totalOutcomes).toBe(5);
    expect(summary.rulesAnalyzed).toBe(1);
    expect(summary.overallSuccessRate).toBeCloseTo(0.4);
    expect(summary.overallAverageImpact).toBe(15);

    const rule = rules[0];
    expect(rule?.rule).toBe('r1');
    expect(rule?.attempts).toBe(5);
    expect(rule?.successes).toBe(2);
    expect(rule?.failures).toBe(1);
    expect(rule?.rolledBack).toBe(1);
    expect(rule?.skipped).toBe(1);
    expect(rule?.successRate).toBeCloseTo(0.4);
    expect(rule?.rollbackRate).toBeCloseTo(0.2);
    expect(rule?.averageImpact).toBe(15);
    expect(rule?.averageDurationMs).toBe(150);
    expect(rule?.lastExecutedAt).toBe('2024-01-05T00:00:00.000Z');
  });

  it('maps outcomes without a rule to unknown', async () => {
    const store = new InMemoryLearningStore();
    await seedOutcomes(store, [{ executionId: 'e1', storeId: 's1', status: 'SUCCESS' }]);
    const { rules } = await new OutcomeAnalyzer(store).analyze();
    expect(rules[0]?.rule).toBe('unknown');
  });

  it('sorts rules by attempts descending', async () => {
    const store = new InMemoryLearningStore();
    await seedOutcomes(store, [
      { executionId: 'e1', storeId: 's1', rule: 'low', status: 'SUCCESS' },
      { executionId: 'e2', storeId: 's1', rule: 'high', status: 'SUCCESS' },
      { executionId: 'e3', storeId: 's1', rule: 'high', status: 'FAILURE' },
    ]);
    const { rules } = await new OutcomeAnalyzer(store).analyze();
    expect(rules.map((rule) => rule.rule)).toEqual(['high', 'low']);
  });

  it('handles an empty store and filters by rule and store', async () => {
    const store = new InMemoryLearningStore();
    const empty = await new OutcomeAnalyzer(store).analyze();
    expect(empty.summary.totalOutcomes).toBe(0);
    expect(empty.summary.overallSuccessRate).toBe(0);
    expect(empty.summary.overallAverageImpact).toBe(0);
    expect(empty.rules).toEqual([]);

    await seedOutcomes(store, [
      { executionId: 'e1', storeId: 's1', rule: 'r1', status: 'SUCCESS' },
      { executionId: 'e2', storeId: 's2', rule: 'r2', status: 'FAILURE' },
    ]);
    const filtered = await new OutcomeAnalyzer(store).analyze({ rule: 'r2', storeId: 's2' });
    expect(filtered.rules).toHaveLength(1);
    expect(filtered.rules[0]?.rule).toBe('r2');
    expect(filtered.summary.totalOutcomes).toBe(1);
  });
});

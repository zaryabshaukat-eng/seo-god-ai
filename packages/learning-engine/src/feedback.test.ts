import { describe, expect, it } from 'vitest';
import { FeedbackValidationError } from './errors.js';
import { FeedbackCollector } from './feedback.js';
import { InMemoryLearningStore } from './store.js';
import type { FeedbackRating } from './types.js';

describe('FeedbackCollector', () => {
  it('records valid feedback with defaults', async () => {
    const store = new InMemoryLearningStore();
    const collector = new FeedbackCollector(store);
    const record = await collector.record({ storeId: 's1', rule: 'missing-title', rating: 1 });
    expect(record.id).toMatch(/^lrn_feedback:/);
    expect(record.source).toBe('user');
    expect(record.createdAt).toBeDefined();
    expect(record.rule).toBe('missing-title');
  });

  it('records feedback against an execution id', async () => {
    const store = new InMemoryLearningStore();
    const collector = new FeedbackCollector(store);
    const record = await collector.record({ storeId: 's1', executionId: 'e1', rating: -1 });
    expect(record.executionId).toBe('e1');
  });

  it('honours provided source, comment and createdAt', async () => {
    const store = new InMemoryLearningStore();
    const collector = new FeedbackCollector(store);
    const at = '2024-01-01T00:00:00.000Z';
    const record = await collector.record({
      storeId: 's1',
      recommendationId: 'rec-1',
      rating: 0,
      comment: 'looks fine',
      source: 'system',
      createdAt: at,
    });
    expect(record.source).toBe('system');
    expect(record.comment).toBe('looks fine');
    expect(record.createdAt).toBe(at);
  });

  it('rejects an invalid rating', async () => {
    const store = new InMemoryLearningStore();
    const collector = new FeedbackCollector(store);
    await expect(
      collector.record({ storeId: 's1', rule: 'r1', rating: 2 as FeedbackRating }),
    ).rejects.toBeInstanceOf(FeedbackValidationError);
  });

  it('rejects feedback with no target', async () => {
    const store = new InMemoryLearningStore();
    const collector = new FeedbackCollector(store);
    await expect(collector.record({ storeId: 's1', rating: 1 })).rejects.toBeInstanceOf(
      FeedbackValidationError,
    );
  });

  it('summarizes feedback across ratings', async () => {
    const store = new InMemoryLearningStore();
    const collector = new FeedbackCollector(store);
    await collector.record({ storeId: 's1', rule: 'r1', rating: 1 });
    await collector.record({ storeId: 's1', rule: 'r1', rating: 1 });
    await collector.record({ storeId: 's1', rule: 'r1', rating: 0 });
    await collector.record({ storeId: 's1', rule: 'r1', rating: -1 });
    const summary = await collector.summarize();
    expect(summary.total).toBe(4);
    expect(summary.positive).toBe(2);
    expect(summary.neutral).toBe(1);
    expect(summary.negative).toBe(1);
    expect(summary.netScore).toBeCloseTo(0.25);
  });

  it('summarizes an empty scope as a zero net score', async () => {
    const store = new InMemoryLearningStore();
    const collector = new FeedbackCollector(store);
    const summary = await collector.summarize({ storeId: 's1' });
    expect(summary.total).toBe(0);
    expect(summary.netScore).toBe(0);
  });
});

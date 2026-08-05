import { describe, expect, it } from 'vitest';
import { LearningConflictError } from './errors.js';
import { InMemoryLearningStore } from './store.js';
import type { FeedbackRecord, LearnedSignal, OutcomeRecord } from './types.js';

const feedback = (id: string, over: Partial<FeedbackRecord> = {}): FeedbackRecord => ({
  id,
  storeId: 's1',
  rating: 1,
  createdAt: '2024-01-01T00:00:00.000Z',
  ...over,
});

const outcome = (id: string, over: Partial<OutcomeRecord> = {}): OutcomeRecord => ({
  id,
  executionId: id,
  storeId: 's1',
  status: 'SUCCESS',
  createdAt: '2024-01-01T00:00:00.000Z',
  ...over,
});

const signal = (id: string, over: Partial<LearnedSignal> = {}): LearnedSignal => ({
  id,
  storeId: 's1',
  rule: 'r1',
  kind: 'positive',
  reward: 1,
  confidence: 1,
  source: 'outcome',
  timestamp: '2024-01-01T00:00:00.000Z',
  ...over,
});

describe('InMemoryLearningStore', () => {
  it('saves and lists feedback', async () => {
    const store = new InMemoryLearningStore();
    await store.saveFeedback(feedback('f1'));
    const records = await store.listFeedback();
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('f1');
  });

  it('rejects duplicate feedback ids', async () => {
    const store = new InMemoryLearningStore();
    await store.saveFeedback(feedback('f1'));
    await expect(store.saveFeedback(feedback('f1'))).rejects.toBeInstanceOf(LearningConflictError);
  });

  it('saves, lists and finds outcomes', async () => {
    const store = new InMemoryLearningStore();
    await store.saveOutcome(outcome('o1'));
    expect(await store.findOutcome('o1')).not.toBeNull();
    expect(await store.findOutcome('missing')).toBeNull();
    expect(await store.listOutcomes()).toHaveLength(1);
  });

  it('rejects duplicate outcome ids', async () => {
    const store = new InMemoryLearningStore();
    await store.saveOutcome(outcome('o1'));
    await expect(store.saveOutcome(outcome('o1'))).rejects.toBeInstanceOf(LearningConflictError);
  });

  it('saves and lists signals, rejecting duplicates', async () => {
    const store = new InMemoryLearningStore();
    await store.saveSignals([signal('g1'), signal('g2')]);
    expect(await store.listSignals()).toHaveLength(2);
    await expect(store.saveSignals([signal('g1')])).rejects.toBeInstanceOf(
      LearningConflictError,
    );
  });

  it('filters by store, rule and since, newest first, with a limit', async () => {
    const store = new InMemoryLearningStore();
    await store.saveFeedback(feedback('too-old', { storeId: 's1', rule: 'r1', createdAt: '2024-01-01T00:00:00.000Z' }));
    await store.saveFeedback(feedback('old', { storeId: 's1', rule: 'r1', createdAt: '2024-01-02T00:00:00.000Z' }));
    await store.saveFeedback(feedback('other-store', { storeId: 's2', rule: 'r1', createdAt: '2024-01-02T00:00:00.000Z' }));
    await store.saveFeedback(feedback('new', { storeId: 's1', rule: 'r2', createdAt: '2024-01-03T00:00:00.000Z' }));
    await store.saveFeedback(feedback('in-range', { storeId: 's1', rule: 'r1', createdAt: '2024-01-04T00:00:00.000Z' }));

    const filtered = await store.listFeedback({ storeId: 's1', rule: 'r1', since: '2024-01-02T00:00:00.000Z' });
    expect(filtered.map((entry) => entry.id)).toEqual(['in-range', 'old']);

    const limited = await store.listFeedback({ limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0]?.id).toBe('in-range');

    const unlimited = await store.listFeedback({ storeId: 's1', limit: 10 });
    expect(unlimited).toHaveLength(4);

    const all = await store.listFeedback();
    expect(all).toHaveLength(5);
    expect(all[0]?.id).toBe('in-range');
  });

  it('filters signals by their timestamp field', async () => {
    const store = new InMemoryLearningStore();
    await store.saveSignals([
      signal('a', { timestamp: '2024-01-01T00:00:00.000Z' }),
      signal('b', { timestamp: '2024-01-05T00:00:00.000Z' }),
    ]);
    const records = await store.listSignals({ since: '2024-01-02T00:00:00.000Z' });
    expect(records.map((entry) => entry.id)).toEqual(['b']);
  });

  it('filters outcomes by store', async () => {
    const store = new InMemoryLearningStore();
    await store.saveOutcome(outcome('o1', { storeId: 's1' }));
    await store.saveOutcome(outcome('o2', { storeId: 's2' }));
    const records = await store.listOutcomes({ storeId: 's2' });
    expect(records.map((entry) => entry.id)).toEqual(['o2']);
  });

  it('resets all data', async () => {
    const store = new InMemoryLearningStore();
    await store.saveFeedback(feedback('f1'));
    await store.saveOutcome(outcome('o1'));
    await store.saveSignals([signal('g1')]);
    await store.reset();
    expect(await store.listFeedback()).toHaveLength(0);
    expect(await store.listOutcomes()).toHaveLength(0);
    expect(await store.listSignals()).toHaveLength(0);
  });
});

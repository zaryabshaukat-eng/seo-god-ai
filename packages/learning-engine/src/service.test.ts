import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '@seogod/monitoring';
import { LearningConflictError } from './errors.js';
import { LearningEngineService } from './service.js';
import { InMemoryLearningStore } from './store.js';

describe('LearningEngineService', () => {
  it('records feedback and summarizes it', async () => {
    const service = new LearningEngineService({ store: new InMemoryLearningStore() });
    const record = await service.recordFeedback({ storeId: 's1', rule: 'r1', rating: 1 });
    expect(record.id).toMatch(/^lrn_feedback:/);
    expect((await service.summarizeFeedback()).total).toBe(1);
    expect(await service.getFeedback()).toHaveLength(1);
  });

  it('ingests outcomes once and rejects duplicates', async () => {
    const service = new LearningEngineService({ store: new InMemoryLearningStore() });
    const record = await service.ingestOutcome({
      executionId: 'e1',
      storeId: 's1',
      rule: 'r1',
      status: 'SUCCESS',
    });
    expect(record.id).toMatch(/^lrn_outcome:/);
    await expect(
      service.ingestOutcome({ executionId: 'e1', storeId: 's1', rule: 'r1', status: 'SUCCESS' }),
    ).rejects.toBeInstanceOf(LearningConflictError);
  });

  it('analyzes, calibrates, scores and exposes historical outcomes', async () => {
    const service = new LearningEngineService({
      store: new InMemoryLearningStore(),
      now: () => '2024-01-01T00:00:00.000Z',
    });
    await service.ingestOutcome({
      executionId: 'e1',
      storeId: 's1',
      rule: 'r1',
      status: 'SUCCESS',
      confidence: 0.9,
      impact: 10,
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    await service.ingestOutcome({
      executionId: 'e2',
      storeId: 's1',
      rule: 'r1',
      status: 'SUCCESS',
      confidence: 0.9,
      impact: 20,
    });

    const analysis = await service.analyzeOutcomes();
    expect(analysis.summary.totalOutcomes).toBe(2);

    const calibration = await service.calibrate('r1', 0.9);
    expect(calibration.calibratedConfidence).toBe(1);

    const scored = await service.scoreRecommendation({
      rule: 'r1',
      confidence: 0.9,
      impact: 1,
      effort: 0.5,
    });
    expect(scored.score).toBeGreaterThanOrEqual(0);

    const historical = await service.getHistoricalOutcomes();
    expect(historical).toEqual([{ rule: 'r1', attempts: 2, successes: 2, averageImpact: 15 }]);
  });

  it('generates and persists signals', async () => {
    const service = new LearningEngineService({ store: new InMemoryLearningStore() });
    await service.ingestOutcome({ executionId: 'e1', storeId: 's1', rule: 'r1', status: 'SUCCESS' });
    const result = await service.generateSignals();
    expect(result.signals).toHaveLength(1);
    expect(await service.getSignals()).toHaveLength(1);
  });

  it('merges existing historical outcomes', async () => {
    const service = new LearningEngineService({ store: new InMemoryLearningStore() });
    await service.ingestOutcome({
      executionId: 'e1',
      storeId: 's1',
      rule: 'r1',
      status: 'SUCCESS',
      impact: 10,
    });
    const historical = await service.getHistoricalOutcomes({}, [
      { rule: 'r1', attempts: 1, successes: 0, averageImpact: 0 },
    ]);
    expect(historical[0]).toMatchObject({ attempts: 2, successes: 1, averageImpact: 5 });
  });

  it('supports store-scoped queries', async () => {
    const service = new LearningEngineService({ store: new InMemoryLearningStore() });
    await service.recordFeedback({ storeId: 's1', rule: 'r1', rating: 1 });
    await service.recordFeedback({ storeId: 's2', rule: 'r1', rating: -1 });
    await service.ingestOutcome({ executionId: 'e1', storeId: 's1', rule: 'r1', status: 'SUCCESS' });
    await service.ingestOutcome({ executionId: 'e2', storeId: 's2', rule: 'r1', status: 'FAILURE' });

    expect(await service.getFeedback({ storeId: 's1' })).toHaveLength(1);
    expect((await service.summarizeFeedback({ storeId: 's1' })).netScore).toBe(1);
    expect((await service.analyzeOutcomes({ storeId: 's1' })).summary.totalOutcomes).toBe(1);
    expect((await service.generateSignals({ storeId: 's1' })).signals).toHaveLength(2);
    expect(await service.getSignals({ storeId: 's1' })).toHaveLength(2);
  });

  it('wires metrics when a registry is provided', async () => {
    const registry = new MetricsRegistry();
    const service = new LearningEngineService({ store: new InMemoryLearningStore(), metrics: registry });
    await service.recordFeedback({ storeId: 's1', rule: 'r1', rating: 1 });
    await service.ingestOutcome({ executionId: 'e1', storeId: 's1', rule: 'r1', status: 'SUCCESS' });
    await service.generateSignals();
    const snapshot = registry.snapshot();
    expect(snapshot.counters['learning_feedback_recorded']).toBe(1);
    expect(snapshot.counters['learning_outcomes_ingested']).toBe(1);
    expect(snapshot.counters['learning_signals_generated']).toBe(2);
  });

  it('uses a custom clock for outcome creation', async () => {
    const at = '2024-02-02T00:00:00.000Z';
    const service = new LearningEngineService({ store: new InMemoryLearningStore(), now: () => at });
    const record = await service.ingestOutcome({
      executionId: 'e1',
      storeId: 's1',
      rule: 'r1',
      status: 'SUCCESS',
    });
    expect(record.createdAt).toBe(at);
  });

  it('resets the store', async () => {
    const service = new LearningEngineService({ store: new InMemoryLearningStore() });
    await service.ingestOutcome({ executionId: 'e1', storeId: 's1', rule: 'r1', status: 'SUCCESS' });
    await service.reset();
    expect(await service.getSignals()).toEqual([]);
    expect((await service.analyzeOutcomes()).rules).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { ConfidenceCalibrator } from './calibration.js';
import { ConfidenceValidationError } from './errors.js';
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

describe('ConfidenceCalibrator', () => {
  it('throws on non-finite confidence', async () => {
    const store = new InMemoryLearningStore();
    const calibrator = new ConfidenceCalibrator(store);
    await expect(calibrator.calibrate('r1', Number.NaN)).rejects.toBeInstanceOf(
      ConfidenceValidationError,
    );
  });

  it('clamps out-of-range confidence', async () => {
    const store = new InMemoryLearningStore();
    const calibrator = new ConfidenceCalibrator(store);
    const report = await calibrator.calibrate('r1', 5);
    expect(report.inputConfidence).toBe(1);
  });

  it('falls back to the input when there is no evidence', async () => {
    const store = new InMemoryLearningStore();
    const report = await new ConfidenceCalibrator(store).calibrate('r1', 0.8);
    expect(report.calibratedConfidence).toBe(0.8);
    expect(report.sampleSize).toBe(0);
    expect(report.empiricalReliability).toBe(0);
    expect(report.buckets).toHaveLength(4);
  });

  it('uses the empirical reliability when the target bucket is empty', async () => {
    const store = new InMemoryLearningStore();
    await seedOutcomes(store, [
      { executionId: 'e1', storeId: 's1', rule: 'r1', status: 'SUCCESS', confidence: 0.9 },
      { executionId: 'e2', storeId: 's1', rule: 'r1', status: 'SUCCESS', confidence: 0.95 },
      { executionId: 'e3', storeId: 's1', rule: 'r1', status: 'FAILURE', confidence: 0.85 },
    ]);
    const report = await new ConfidenceCalibrator(store).calibrate('r1', 0.1);
    expect(report.empiricalReliability).toBeCloseTo(2 / 3);
    expect(report.calibratedConfidence).toBeCloseTo(2 / 3);
    expect(report.buckets[0]).toMatchObject({ count: 0, observedReliability: 0 });
  });

  it('uses the bucket reliability when the target bucket has data', async () => {
    const store = new InMemoryLearningStore();
    await seedOutcomes(store, [
      { executionId: 'e1', storeId: 's1', rule: 'r1', status: 'SUCCESS', confidence: 0.9 },
      { executionId: 'e2', storeId: 's1', rule: 'r1', status: 'SUCCESS', confidence: 0.95 },
      { executionId: 'e3', storeId: 's1', rule: 'r1', status: 'FAILURE', confidence: 0.85 },
      { executionId: 'e4', storeId: 's1', rule: 'r1', status: 'SUCCESS', confidence: 0.6 },
      { executionId: 'e5', storeId: 's1', rule: 'r1', status: 'FAILURE', confidence: 0.1 },
    ]);
    const report = await new ConfidenceCalibrator(store).calibrate('r1', 0.9);
    expect(report.buckets[3]).toMatchObject({ count: 3, successes: 2 });
    expect(report.calibratedConfidence).toBeCloseTo(2 / 3);
    expect(report.sampleSize).toBe(5);
  });

  it('ignores outcomes without a confidence label', async () => {
    const store = new InMemoryLearningStore();
    await seedOutcomes(store, [
      { executionId: 'e1', storeId: 's1', rule: 'r1', status: 'SUCCESS' },
      { executionId: 'e2', storeId: 's1', rule: 'r1', status: 'SUCCESS', confidence: 0.9 },
    ]);
    const report = await new ConfidenceCalibrator(store).calibrate('r1', 0.9);
    expect(report.sampleSize).toBe(1);
    expect(report.calibratedConfidence).toBe(1);
  });

  it('scopes calibration to a store', async () => {
    const store = new InMemoryLearningStore();
    await seedOutcomes(store, [
      { executionId: 'e1', storeId: 's1', rule: 'r1', status: 'SUCCESS', confidence: 0.9 },
      { executionId: 'e2', storeId: 's2', rule: 'r1', status: 'FAILURE', confidence: 0.9 },
    ]);
    const report = await new ConfidenceCalibrator(store).calibrate('r1', 0.9, { storeId: 's1' });
    expect(report.calibratedConfidence).toBe(1);
    expect(report.sampleSize).toBe(1);
  });
});

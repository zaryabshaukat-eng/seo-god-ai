import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '@seogod/monitoring';
import { LEARNING_METRICS_NAMES, LearningMetrics } from './metrics.js';

describe('LearningMetrics', () => {
  it('increments each counter on the registry', () => {
    const registry = new MetricsRegistry();
    const metrics = new LearningMetrics(registry);
    metrics.feedbackRecorded();
    metrics.outcomesIngested(2);
    metrics.signalsGenerated(3);
    metrics.calibrations();
    metrics.scoring();
    metrics.analyses();

    const snapshot = registry.snapshot();
    expect(snapshot.counters[LEARNING_METRICS_NAMES.feedbackRecorded]).toBe(1);
    expect(snapshot.counters[LEARNING_METRICS_NAMES.outcomesIngested]).toBe(2);
    expect(snapshot.counters[LEARNING_METRICS_NAMES.signalsGenerated]).toBe(3);
    expect(snapshot.counters[LEARNING_METRICS_NAMES.calibrations]).toBe(1);
    expect(snapshot.counters[LEARNING_METRICS_NAMES.scoring]).toBe(1);
    expect(snapshot.counters[LEARNING_METRICS_NAMES.analyses]).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { InvalidExecutionError } from '../utils/errors.js';
import { DEFAULT_SAFETY_CONFIG, assertValidConfig, isModeAllowed, normalizeSafetyConfig } from './config.js';

describe('safety config', () => {
  it('normalizeSafetyConfig merges overrides onto defaults', () => {
    const config = normalizeSafetyConfig({ maxBatchSize: 10, featureFlags: { 'allow-production': true } });
    expect(config.maxBatchSize).toBe(10);
    expect(config.maxWriteRatePerMinute).toBe(DEFAULT_SAFETY_CONFIG.maxWriteRatePerMinute);
    expect(config.featureFlags['allow-production']).toBe(true);
  });

  it('assertValidConfig rejects non-positive limits', () => {
    expect(() => assertValidConfig(normalizeSafetyConfig({ maxBatchSize: 0 }))).toThrow(InvalidExecutionError);
    expect(() => assertValidConfig(normalizeSafetyConfig({ maxWriteRatePerMinute: -1 }))).toThrow(InvalidExecutionError);
    expect(() => assertValidConfig(normalizeSafetyConfig({ executionTimeoutMs: 0 }))).toThrow(InvalidExecutionError);
    expect(() => assertValidConfig(normalizeSafetyConfig({ maxConcurrency: NaN }))).toThrow(InvalidExecutionError);
    expect(() => assertValidConfig(normalizeSafetyConfig({ allowedModes: [] }))).toThrow(InvalidExecutionError);
    expect(() => assertValidConfig(normalizeSafetyConfig({ maxRetries: -1 }))).toThrow(InvalidExecutionError);
    expect(() => assertValidConfig(normalizeSafetyConfig({ backoffMs: -1 }))).toThrow(InvalidExecutionError);
  });

  it('assertValidConfig accepts zero retries and backoff', () => {
    expect(() => assertValidConfig(normalizeSafetyConfig({ maxRetries: 0, backoffMs: 0 }))).not.toThrow();
  });

  it('isModeAllowed honors allowedModes', () => {
    const config = normalizeSafetyConfig({ allowedModes: ['DRY_RUN', 'PRODUCTION'] });
    expect(isModeAllowed('DRY_RUN', config)).toBe(true);
    expect(isModeAllowed('PRODUCTION', config)).toBe(true);
    expect(isModeAllowed('SIMULATION', config)).toBe(false);
  });
});

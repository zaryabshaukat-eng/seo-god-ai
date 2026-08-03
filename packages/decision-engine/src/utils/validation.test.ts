import { ValidationError } from '@seogod/core';
import { describe, expect, it } from 'vitest';
import { decisionInput } from '../test/fixtures.js';
import { validateDecisionInput } from './validation.js';

describe('validateDecisionInput', () => {
  it('accepts a valid input', () => {
    expect(() => validateDecisionInput(decisionInput())).not.toThrow();
  });

  it('rejects an empty storeId', () => {
    expect(() => validateDecisionInput(decisionInput({ storeId: '' }))).toThrow(ValidationError);
  });

  it('rejects an empty recommendation list', () => {
    expect(() => validateDecisionInput(decisionInput({ recommendations: [] }))).toThrow(
      ValidationError,
    );
  });

  it('rejects a non-positive maxBatchSize', () => {
    const input = decisionInput();
    input.storeSettings.maxBatchSize = 0;
    expect(() => validateDecisionInput(input)).toThrow(ValidationError);
  });

  it('rejects a non-positive maxChangesPerResource', () => {
    const input = decisionInput();
    input.storeSettings.maxChangesPerResource = -1;
    expect(() => validateDecisionInput(input)).toThrow(ValidationError);
  });

  it('rejects an invalid planCapRecommendations', () => {
    const input = decisionInput();
    input.storeSettings.planCapRecommendations = 0;
    expect(() => validateDecisionInput(input)).toThrow(ValidationError);
  });

  it('accepts a null planCapRecommendations', () => {
    const input = decisionInput();
    input.storeSettings.planCapRecommendations = null;
    expect(() => validateDecisionInput(input)).not.toThrow();
  });

  it('rejects a recommendation without an id', () => {
    const input = decisionInput();
    input.recommendations[0]!.id = '';
    expect(() => validateDecisionInput(input)).toThrow(ValidationError);
  });

  it('rejects a recommendation without a rule', () => {
    const input = decisionInput();
    input.recommendations[0]!.rule = '';
    expect(() => validateDecisionInput(input)).toThrow(ValidationError);
  });
});

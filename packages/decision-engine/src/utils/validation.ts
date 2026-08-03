import { ValidationError } from '@seogod/core';
import type { DecisionEngineInput } from '../types/input.js';

/** Validates a decision input; throws {@link ValidationError} when invalid. */
export function validateDecisionInput(input: DecisionEngineInput): void {
  if (input.storeId === '') {
    throw new ValidationError('storeId is required', {
      module: 'decision-engine',
      operation: 'validateDecisionInput',
    });
  }
  if (!Array.isArray(input.recommendations) || input.recommendations.length === 0) {
    throw new ValidationError('at least one recommendation is required', {
      module: 'decision-engine',
      operation: 'validateDecisionInput',
    });
  }
  const settings = input.storeSettings;
  if (settings.maxBatchSize <= 0) {
    throw new ValidationError('storeSettings.maxBatchSize must be positive', {
      module: 'decision-engine',
      operation: 'validateDecisionInput',
    });
  }
  if (settings.maxChangesPerResource <= 0) {
    throw new ValidationError('storeSettings.maxChangesPerResource must be positive', {
      module: 'decision-engine',
      operation: 'validateDecisionInput',
    });
  }
  if (settings.planCapRecommendations !== null && settings.planCapRecommendations < 1) {
    throw new ValidationError('storeSettings.planCapRecommendations must be >= 1 or null', {
      module: 'decision-engine',
      operation: 'validateDecisionInput',
    });
  }
  for (const recommendation of input.recommendations) {
    if (recommendation.id === '') {
      throw new ValidationError('recommendation id is required', {
        module: 'decision-engine',
        operation: 'validateDecisionInput',
      });
    }
    if (recommendation.rule === '') {
      throw new ValidationError('recommendation rule is required', {
        module: 'decision-engine',
        operation: 'validateDecisionInput',
      });
    }
  }
}

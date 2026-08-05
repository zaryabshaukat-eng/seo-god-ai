import { describe, expect, it } from 'vitest';
import { isAppError } from '@seogod/core';
import {
  ConfidenceValidationError,
  FeedbackValidationError,
  LearningConflictError,
  LearningError,
  LearningNotFoundError,
  LearningValidationError,
  OutcomeValidationError,
  ScoreValidationError,
} from './errors.js';

describe('LearningError hierarchy', () => {
  it('exposes machine-readable codes and context', () => {
    const error = new FeedbackValidationError('bad rating', { rule: 'missing-title', storeId: 's1' });
    expect(error).toBeInstanceOf(LearningError);
    expect(isAppError(error)).toBe(true);
    expect(error.code).toBe('feedback.invalid');
    expect(error.context.rule).toBe('missing-title');
    expect(error.context.storeId).toBe('s1');
    expect(error.toJSON().name).toBe('FeedbackValidationError');
    expect(error.retryable).toBe(false);
  });

  it('assigns each specific error its code', () => {
    expect(new OutcomeValidationError('o').code).toBe('outcome.invalid');
    expect(new ConfidenceValidationError('c').code).toBe('confidence.invalid');
    expect(new ScoreValidationError('s').code).toBe('score.invalid');
    expect(new LearningValidationError('v').code).toBe('validation.error');
    expect(new LearningNotFoundError('n').code).toBe('not_found');
    expect(new LearningConflictError('x').code).toBe('conflict');
  });

  it('carries causes, request ids and operation metadata on the base error', () => {
    const cause = new Error('boom');
    const error = new LearningError('wrapped', {
      code: 'learning.not_found',
      cause,
      requestId: 'req-1',
      context: { rule: 'r1' },
    });
    expect(error.cause).toBe(cause);
    expect(error.requestId).toBe('req-1');
    expect(error.operation).toBeUndefined();
    expect(error.module).toBeUndefined();
    expect(error.context.rule).toBe('r1');
  });
});

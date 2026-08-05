/**
 * Typed error hierarchy for learning-engine failures.
 *
 * Every error extends the platform-wide {@link AppError} so loggers,
 * monitoring and the API layer handle failures uniformly, while keeping
 * learning-specific codes and context.
 */

import { AppError, ConflictError, NotFoundError, ValidationError } from '@seogod/core';

export type LearningErrorCode =
  | 'feedback.invalid'
  | 'outcome.invalid'
  | 'confidence.invalid'
  | 'score.invalid'
  | 'learning.not_found'
  | 'learning.conflict';

export interface LearningErrorContext extends Record<string, unknown> {
  rule?: string;
  storeId?: string;
  executionId?: string;
}

export class LearningError extends AppError {
  declare readonly code: LearningErrorCode;
  declare readonly context: LearningErrorContext;

  constructor(
    message: string,
    options: {
      code: LearningErrorCode;
      context?: LearningErrorContext;
      cause?: unknown;
      requestId?: string;
    },
  ) {
    super(message, {
      code: options.code,
      context: options.context,
      cause: options.cause,
      requestId: options.requestId,
    });
  }
}

/** Feedback input was invalid (bad rating, missing target). */
export class FeedbackValidationError extends LearningError {
  constructor(message: string, context?: LearningErrorContext) {
    super(message, { code: 'feedback.invalid', context });
  }
}

/** Outcome input was invalid (bad status, missing ids). */
export class OutcomeValidationError extends LearningError {
  constructor(message: string, context?: LearningErrorContext) {
    super(message, { code: 'outcome.invalid', context });
  }
}

/** A confidence value was not a finite number in range. */
export class ConfidenceValidationError extends LearningError {
  constructor(message: string, context?: LearningErrorContext) {
    super(message, { code: 'confidence.invalid', context });
  }
}

/** Score input factors were invalid. */
export class ScoreValidationError extends LearningError {
  constructor(message: string, context?: LearningErrorContext) {
    super(message, { code: 'score.invalid', context });
  }
}

/** A requested entity was not found in the learning store. */
export class LearningNotFoundError extends NotFoundError {
  constructor(message: string, context?: LearningErrorContext) {
    super(message, { module: 'learning-engine', operation: 'learning.lookup', context });
  }
}

/** A write collided with an existing record (e.g. duplicate outcome). */
export class LearningConflictError extends ConflictError {
  constructor(message: string, context?: LearningErrorContext) {
    super(message, { module: 'learning-engine', operation: 'learning.write', context });
  }
}

/** Generic validation failure raised by the service facade. */
export class LearningValidationError extends ValidationError {
  constructor(message: string, context?: LearningErrorContext) {
    super(message, { module: 'learning-engine', operation: 'learning.validate', context });
  }
}

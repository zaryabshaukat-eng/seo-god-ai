import { AppError, ConfigurationError, ValidationError } from '@seogod/core';

/** Base error for orchestrator-internal failures. */
export class OrchestratorError extends AppError {
  constructor(
    message: string,
    options: { context?: Record<string, unknown>; code?: string; retryable?: boolean } = {},
  ) {
    super(message, {
      ...options,
      code: options.code ?? 'orchestrator.error',
      module: 'ai-orchestrator',
    });
  }
}

/** A workflow/step exceeded its time budget. Retryable. */
export class TimeoutError extends OrchestratorError {
  constructor(message: string, options: { context?: Record<string, unknown> } = {}) {
    super(message, {
      ...options,
      code: 'orchestrator.timeout',
      retryable: true,
    });
  }
}

/** Execution was cancelled via the abort signal. */
export class CancelledError extends AppError {
  constructor(message: string) {
    super(message, {
      code: 'orchestrator.cancelled',
      module: 'ai-orchestrator',
    });
  }
}

/** An agent output failed schema/response validation. Never retryable. */
export class ValidationFailedError extends ValidationError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { module: 'ai-orchestrator', context });
  }
}

/** An agent output was blocked by the safety guard. Never retryable. */
export class SafetyViolationError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, {
      code: 'orchestrator.safety.violation',
      module: 'ai-orchestrator',
      context,
    });
  }
}

/** An unknown or misconfigured provider was requested. */
export class UnsupportedProviderError extends ConfigurationError {
  constructor(message: string) {
    super(message, { module: 'ai-orchestrator' });
  }
}

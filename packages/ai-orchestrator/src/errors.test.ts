import { AppError, ConfigurationError, isAppError, ValidationError } from '@seogod/core';
import { describe, expect, it } from 'vitest';
import {
  CancelledError,
  OrchestratorError,
  SafetyViolationError,
  TimeoutError,
  UnsupportedProviderError,
  ValidationFailedError,
} from './errors.js';

describe('orchestrator errors', () => {
  it('OrchestratorError carries the right identity', () => {
    const error = new OrchestratorError('boom', { context: { stepId: 's' } });
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('orchestrator.error');
    expect(error.module).toBe('ai-orchestrator');
    expect(error.retryable).toBe(false);
    expect(error.context).toEqual({ stepId: 's' });
  });

  it('TimeoutError is retryable', () => {
    const error = new TimeoutError('slow');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('orchestrator.timeout');
    expect(error.retryable).toBe(true);
  });

  it('CancelledError is a plain AppError', () => {
    const error = new CancelledError('cancelled');
    expect(error.code).toBe('orchestrator.cancelled');
    expect(error.retryable).toBe(false);
    expect(isAppError(error)).toBe(true);
  });

  it('ValidationFailedError extends core ValidationError and is not retryable', () => {
    const error = new ValidationFailedError('invalid output', { stepId: 's' });
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.module).toBe('ai-orchestrator');
    expect(error.context).toEqual({ stepId: 's' });
    expect(error.retryable).toBe(false);
  });

  it('SafetyViolationError is distinct and never retryable', () => {
    const error = new SafetyViolationError('blocked', { action: 'delete_page' });
    expect(error.code).toBe('orchestrator.safety.violation');
    expect(error.retryable).toBe(false);
    expect(error.context).toEqual({ action: 'delete_page' });
  });

  it('UnsupportedProviderError extends ConfigurationError', () => {
    const error = new UnsupportedProviderError('anthropic');
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toContain('anthropic');
  });

  it('serializes to JSON safely', () => {
    const error = new OrchestratorError('boom');
    const json = error.toJSON();
    expect(json.code).toBe('orchestrator.error');
    expect(json.name).toBe('OrchestratorError');
    expect(json.retryable).toBe(false);
  });
});

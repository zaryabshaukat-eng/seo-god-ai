import { describe, expect, it } from 'vitest';
import { AppError, ErrorCodes } from './index.js';
import {
  AiError,
  AuthenticationError,
  AuthorizationError,
  ConfigurationError,
  ConflictError,
  DatabaseError,
  DomainError,
  IntegrationError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  UnexpectedError,
  ValidationError,
} from './errors.js';

const classes = [
  [DomainError, ErrorCodes.domain, false],
  [ValidationError, ErrorCodes.validation, false],
  [AuthenticationError, ErrorCodes.authentication, false],
  [AuthorizationError, ErrorCodes.authorization, false],
  [NotFoundError, ErrorCodes.notFound, false],
  [ConflictError, ErrorCodes.conflict, false],
  [ConfigurationError, ErrorCodes.configuration, false],
  [DatabaseError, ErrorCodes.database, false],
  [AiError, ErrorCodes.ai, false],
  [IntegrationError, ErrorCodes.integration, false],
  [UnexpectedError, ErrorCodes.unexpected, false],
  [NetworkError, ErrorCodes.network, true],
  [RateLimitError, ErrorCodes.rateLimit, true],
] as const;

describe('concrete error classes', () => {
  for (const [cls, code, retryable] of classes) {
    it(`${cls.name} uses code ${code} and retryable=${retryable}`, () => {
      const error = new cls('message', { module: 'test', operation: 'op' });
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(retryable);
      expect(error.module).toBe('test');
      expect(error.operation).toBe('op');
    });
  }

  it('RateLimitError carries retryAfterSeconds', () => {
    const error = new RateLimitError('too many requests', { retryAfterSeconds: 12 });
    expect(error.retryAfterSeconds).toBe(12);
    expect(new RateLimitError('x').retryAfterSeconds).toBeUndefined();
  });

  it('ValidationError defaults to non-retryable but honors explicit overrides', () => {
    expect(new ValidationError('bad input').retryable).toBe(false);
    expect(new ValidationError('bad input', { retryable: true }).retryable).toBe(true);
  });

  it('errors can be caught as AppError', () => {
    const thrown = () => {
      throw new NotFoundError('gone');
    };
    expect(thrown).toThrow(AppError);
  });
});

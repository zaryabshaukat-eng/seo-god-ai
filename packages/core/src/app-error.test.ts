import { describe, expect, it } from 'vitest';
import { AppError, isAppError } from './app-error.js';

describe('AppError', () => {
  it('sets the standard fields', () => {
    const error = new AppError('boom', {
      code: 'test.code',
      context: { storeId: 'store-1' },
      operation: 'run.job',
      module: 'test',
      requestId: 'req-1',
      retryable: true,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe('test.code');
    expect(error.message).toBe('boom');
    expect(error.context).toEqual({ storeId: 'store-1' });
    expect(error.operation).toBe('run.job');
    expect(error.module).toBe('test');
    expect(error.requestId).toBe('req-1');
    expect(error.retryable).toBe(true);
    expect(error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('uses sensible defaults', () => {
    const error = new AppError('boom', { code: 'x' });
    expect(error.retryable).toBe(false);
    expect(error.context).toEqual({});
    expect(error.operation).toBeUndefined();
    expect(error.module).toBeUndefined();
    expect(error.requestId).toBeUndefined();
  });

  it('freezes the context object', () => {
    const error = new AppError('boom', { code: 'x', context: { a: 1 } });
    expect(() => {
      (error.context as Record<string, unknown>).b = 2;
    }).toThrow();
  });

  it('sets the correct name for subclasses', () => {
    class CustomError extends AppError {
      constructor() {
        super('custom', { code: 'custom' });
      }
    }
    expect(new CustomError().name).toBe('CustomError');
  });

  it('preserves the underlying cause', () => {
    const cause = new Error('root cause');
    const error = new AppError('wrapped', { code: 'x', cause });
    expect(error.cause).toBe(cause);
  });

  it('serializes to a safe JSON representation', () => {
    const error = new AppError('boom', { code: 'x', context: { a: 1 }, operation: 'op' });
    const json = error.toJSON();
    expect(json).toMatchObject({
      name: 'AppError',
      code: 'x',
      message: 'boom',
      context: { a: 1 },
      operation: 'op',
      retryable: false,
    });
    expect(json.stack).toBeUndefined();
  });
});

describe('isAppError', () => {
  it('recognizes AppError instances', () => {
    expect(isAppError(new AppError('x', { code: 'x' }))).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});

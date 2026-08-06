import { describe, expect, it } from 'vitest';
import {
  WebError,
  WebAuthError,
  WebConflictError,
  WebNetworkError,
  WebNotFoundError,
  WebPermissionError,
  WebValidationError,
  errorMessage,
  fromApiError,
  toWebError,
} from './errors.js';
import { AppError } from '@seogod/core';

describe('WebError hierarchy', () => {
  it('sets module, code and operation on the base error', () => {
    const error = new WebError('boom', { code: 'web.test.error', operation: 'test' });
    expect(error).toBeInstanceOf(Error);
    expect(error.module).toBe('web');
    expect(error.code).toBe('web.test.error');
    expect(error.operation).toBe('test');
    expect(error.retryable).toBe(false);
  });

  it('lets options override the module', () => {
    const error = new WebError('boom', { code: 'x', module: 'custom' });
    expect(error.module).toBe('custom');
  });

  it('subclasses carry their own codes', () => {
    expect(new WebValidationError('v').code).toBe('web.validation.error');
    expect(new WebAuthError('a').code).toBe('web.auth.error');
    expect(new WebPermissionError('p').code).toBe('web.permission.error');
    expect(new WebNetworkError('n').retryable).toBe(true);
    expect(new WebNotFoundError('nf').code).toBe('web.not_found.error');
    expect(new WebConflictError('c').code).toBe('web.conflict.error');
  });

  it('serializes to a safe JSON representation', () => {
    const json = new WebAuthError('no').toJSON();
    expect(json).toMatchObject({ name: 'WebAuthError', code: 'web.auth.error', message: 'no' });
  });
});

describe('toWebError', () => {
  it('passes WebErrors through unchanged', () => {
    const error = new WebValidationError('keep');
    expect(toWebError(error)).toBe(error);
  });

  it('wraps AppErrors preserving their metadata', () => {
    const inner = new AppError('platform failed', { code: 'x.platform', retryable: true });
    const wrapped = toWebError(inner);
    expect(wrapped).toBeInstanceOf(WebError);
    expect(wrapped.message).toBe('platform failed');
    expect(wrapped.code).toBe('x.platform');
    expect(wrapped.retryable).toBe(true);
    expect(wrapped.cause).toBe(inner);
  });

  it('wraps plain Errors as network errors', () => {
    const wrapped = toWebError(new Error('tcp down'));
    expect(wrapped).toBeInstanceOf(WebNetworkError);
    expect(wrapped.message).toBe('tcp down');
  });

  it('falls back for unknown values', () => {
    const wrapped = toWebError(42, 'fallback message');
    expect(wrapped).toBeInstanceOf(WebError);
    expect(wrapped.message).toBe('fallback message');
  });
});

describe('fromApiError', () => {
  it('maps status codes to specific error types', () => {
    expect(fromApiError(401, {})).toBeInstanceOf(WebAuthError);
    expect(fromApiError(403, {})).toBeInstanceOf(WebPermissionError);
    expect(fromApiError(404, {})).toBeInstanceOf(WebNotFoundError);
    expect(fromApiError(409, {})).toBeInstanceOf(WebConflictError);
    expect(fromApiError(422, { message: 'bad input' })).toBeInstanceOf(WebValidationError);
    expect(fromApiError(400, {})).toBeInstanceOf(WebValidationError);
    expect(fromApiError(500, { retryable: true })).toBeInstanceOf(WebError);
    expect(fromApiError(418, { message: 'teapot' })).toBeInstanceOf(WebError);
  });

  it('uses the body message and attaches context', () => {
    const error = fromApiError(403, { message: 'nope', code: 'x.denied', context: { reason: 'role' } });
    expect(error.message).toBe('nope');
    expect(error.code).toBe('web.permission.error');
    expect(error.context).toMatchObject({ status: 403, reason: 'role', code: 'x.denied' });
  });

  it('falls back to a status message when none is provided', () => {
    const error = fromApiError(404, {});
    expect(error.message).toBe('Request failed with status 404.');
  });

  it('defaults the code when missing', () => {
    expect(fromApiError(500, {}).code).toBe('web.http.error');
  });
});

describe('errorMessage', () => {
  it('returns the message of Errors', () => {
    expect(errorMessage(new Error('x'))).toBe('x');
  });

  it('stringifies non-errors', () => {
    expect(errorMessage('nope')).toBe('nope');
    expect(errorMessage(7)).toBe('7');
  });
});

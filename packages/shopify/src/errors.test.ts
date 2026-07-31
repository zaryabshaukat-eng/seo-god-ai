import { describe, expect, it } from 'vitest';
import { AppError, ErrorCodes, isAppError } from '@seogod/core';
import {
  ShopifyApiError,
  ShopifyError,
  ShopifyNetworkError,
  ShopifyRateLimitError,
  ShopifyValidationError,
} from './errors.js';

describe('ShopifyError integrates with core AppError', () => {
  it('is an AppError and passes the isAppError guard', () => {
    const error = new ShopifyValidationError('bad input', { shopDomain: 'acme.myshopify.com' });
    expect(error).toBeInstanceOf(AppError);
    expect(isAppError(error)).toBe(true);
  });

  it('has no platform collision codes', () => {
    const error = new ShopifyNetworkError('socket hang up', { shopDomain: 'acme' });
    expect(error.code).not.toBe(ErrorCodes.unexpected);
  });

  it('maps ShopifyApiError requestId onto the AppError field', () => {
    const error = new ShopifyApiError('5xx', {
      status: 502,
      requestId: 'req-123',
    });
    expect(error.requestId).toBe('req-123');
    expect(error.status).toBe(502);
  });

  it('ShopifyRateLimitError stays retryable with retryAfterSeconds', () => {
    const error = new ShopifyRateLimitError('throttled', undefined, 30);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('produces the correct name', () => {
    expect(new ShopifyError('x', { code: 'API_ERROR' }).name).toBe('ShopifyError');
  });
});

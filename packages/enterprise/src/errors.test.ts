import { describe, expect, it } from 'vitest';
import { ValidationError, isAppError } from '@seogod/core';
import {
  EnterpriseAuthenticationError,
  EnterpriseAuthorizationError,
  EnterpriseBillingError,
  EnterpriseConflictError,
  EnterpriseError,
  EnterpriseIsolationError,
  EnterpriseLimitError,
  EnterpriseNotFoundError,
  EnterpriseValidationError,
  EnterpriseWebhookError,
} from './errors.js';

describe('EnterpriseError hierarchy', () => {
  it('exposes stable codes and structured context', () => {
    const error = new EnterpriseValidationError('bad input', {
      tenantId: 't1',
      resourceId: 'r1',
    });
    expect(error).toBeInstanceOf(ValidationError);
    expect(isAppError(error)).toBe(true);
    expect(error.code).toBe('validation.error');
    expect(error.context.tenantId).toBe('t1');
    expect(error.context.resourceId).toBe('r1');
    expect(error.retryable).toBe(false);
  });

  it('assigns each core-derived error its canonical code', () => {
    expect(new EnterpriseValidationError('v').code).toBe('validation.error');
    expect(new EnterpriseNotFoundError('n').code).toBe('not_found');
    expect(new EnterpriseConflictError('c').code).toBe('conflict');
    expect(new EnterpriseAuthenticationError('a').code).toBe('authentication.failed');
    expect(new EnterpriseAuthorizationError('z').code).toBe('authorization.denied');
    expect(new EnterpriseIsolationError('i').code).toBe('authorization.denied');
  });

  it('uses enterprise-specific codes for the base subclasses', () => {
    expect(new EnterpriseBillingError('b', { tenantId: 't1' }).code).toBe('enterprise.billing');
    expect(new EnterpriseLimitError('l', { tenantId: 't1' }).code).toBe('enterprise.limit');
    expect(new EnterpriseWebhookError('w', { tenantId: 't1' }).code).toBe('enterprise.webhook');
  });

  it('carries causes and request ids', () => {
    const cause = new Error('stripe down');
    const error = new EnterpriseBillingError('sync failed', { tenantId: 't1', planId: 'pro' }, cause);
    expect(error.cause).toBe(cause);
    expect(error.context.planId).toBe('pro');
    expect(error.toJSON().name).toBe('EnterpriseBillingError');
  });

  it('supports an explicit enterprise code on the base class', () => {
    const error = new EnterpriseError('opaque', {
      code: 'enterprise.isolation',
      context: { tenantId: 't1' },
      requestId: 'req-9',
    });
    expect(error.code).toBe('enterprise.isolation');
    expect(error.requestId).toBe('req-9');
  });
});

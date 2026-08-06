/**
 * Typed error hierarchy for the enterprise layer. Extends the platform-wide
 * `@seogod/core` errors so loggers, monitoring and the API layer handle
 * tenancy, authorization, isolation, billing and webhook failures uniformly
 * with stable codes and structured context.
 */

import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@seogod/core';
import { AppError } from '@seogod/core';

export type EnterpriseErrorCode =
  | 'enterprise.validation'
  | 'enterprise.not_found'
  | 'enterprise.conflict'
  | 'enterprise.authorization'
  | 'enterprise.authentication'
  | 'enterprise.isolation'
  | 'enterprise.billing'
  | 'enterprise.limit'
  | 'enterprise.webhook';

export interface EnterpriseErrorContext extends Record<string, unknown> {
  tenantId?: string;
  userId?: string;
  resourceId?: string;
  permission?: string;
  planId?: string;
}

export class EnterpriseError extends AppError {
  declare readonly code: EnterpriseErrorCode;
  declare readonly context: EnterpriseErrorContext;

  constructor(
    message: string,
    options: {
      code: EnterpriseErrorCode;
      context?: EnterpriseErrorContext;
      cause?: unknown;
      requestId?: string;
      retryable?: boolean;
    },
  ) {
    super(message, {
      code: options.code,
      context: options.context,
      cause: options.cause,
      requestId: options.requestId,
      retryable: options.retryable,
    });
  }
}

/** Enterprise input was invalid. */
export class EnterpriseValidationError extends ValidationError {
  constructor(message: string, context?: EnterpriseErrorContext) {
    super(message, { module: 'enterprise', operation: 'enterprise.validate', context });
  }
}

/** A requested enterprise entity does not exist. */
export class EnterpriseNotFoundError extends NotFoundError {
  constructor(message: string, context?: EnterpriseErrorContext) {
    super(message, { module: 'enterprise', operation: 'enterprise.lookup', context });
  }
}

/** A write collided with existing state (duplicate slug, key name, …). */
export class EnterpriseConflictError extends ConflictError {
  constructor(message: string, context?: EnterpriseErrorContext) {
    super(message, { module: 'enterprise', operation: 'enterprise.write', context });
  }
}

/** The actor is authenticated but lacks the required permission/role. */
export class EnterpriseAuthorizationError extends AuthorizationError {
  constructor(message: string, context?: EnterpriseErrorContext) {
    super(message, { module: 'enterprise', operation: 'enterprise.authorize', context });
  }
}

/** Authentication failed (invalid/expired API key or token). */
export class EnterpriseAuthenticationError extends AuthenticationError {
  constructor(message: string, context?: EnterpriseErrorContext) {
    super(message, { module: 'enterprise', operation: 'enterprise.authenticate', context });
  }
}

/** A cross-tenant access attempt was rejected by an isolation guard. */
export class EnterpriseIsolationError extends AuthorizationError {
  constructor(message: string, context?: EnterpriseErrorContext) {
    super(message, { module: 'enterprise', operation: 'enterprise.isolation', context });
  }
}

/** A billing operation (hook call, subscription transition) failed. */
export class EnterpriseBillingError extends EnterpriseError {
  constructor(message: string, context?: EnterpriseErrorContext, cause?: unknown) {
    super(message, { code: 'enterprise.billing', context, cause });
  }
}

/** The tenant exceeded an entitlement limit (seats, keys, webhooks, …). */
export class EnterpriseLimitError extends EnterpriseError {
  constructor(message: string, context?: EnterpriseErrorContext) {
    super(message, { code: 'enterprise.limit', context });
  }
}

/** A webhook registration or delivery failed. */
export class EnterpriseWebhookError extends EnterpriseError {
  constructor(message: string, context?: EnterpriseErrorContext, cause?: unknown) {
    super(message, { code: 'enterprise.webhook', context, cause });
  }
}

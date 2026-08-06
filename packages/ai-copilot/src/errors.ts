/**
 * Copilot-specific error hierarchy. Everything extends `AppError` (via core)
 * so API layers, loggers and monitoring can handle failures uniformly.
 */

import {
  AiError,
  AuthorizationError,
  IntegrationError,
  NotFoundError,
  ValidationError,
} from '@seogod/core';
import type { ErrorOptions } from '@seogod/core';

const MODULE = 'ai-copilot';

/** Base error for copilot failures. */
export class CopilotError extends AiError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, module: MODULE });
  }
}

/** Invalid chat input (empty message, missing tenant, bad arguments). */
export class CopilotValidationError extends ValidationError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, module: MODULE });
  }
}

/** The requested session/entity does not exist. */
export class CopilotNotFoundError extends NotFoundError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, module: MODULE });
  }
}

/** The actor is not allowed to chat or run a tool. */
export class CopilotAuthorizationError extends AuthorizationError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, module: MODULE });
  }
}

/** A session belongs to another tenant. */
export class CopilotIsolationError extends AuthorizationError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, module: MODULE });
  }
}

/** The underlying chat model failed or produced an unusable response. */
export class CopilotProviderError extends IntegrationError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, module: MODULE });
  }
}

/** A tool failed while answering. */
export class CopilotToolError extends CopilotError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, module: MODULE });
  }
}

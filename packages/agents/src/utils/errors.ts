import { AppError, type ErrorOptions } from '@seogod/core';

/** Options for agent errors; `code` may be overridden by subclasses. */
export interface AgentErrorOptions extends ErrorOptions {
  code?: string;
}

/** Base error for the agents package. Always tagged with `module: "agents"`. */
export class AgentError extends AppError {
  constructor(message: string, options: AgentErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'agents.error', module: 'agents' });
  }
}

/** Raised when a proposed action violates the safety policy. */
export class SafetyViolationError extends AgentError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: 'agents.safety_violation' });
  }
}

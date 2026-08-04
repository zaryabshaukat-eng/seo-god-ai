import type { ValidationResult } from '../types/validation.js';

export function ok(): ValidationResult {
  return { valid: true, failures: [] };
}

export function fail(check: string, code: string, message: string, context?: Record<string, unknown>): ValidationResult {
  return {
    valid: false,
    failures: [{ check, code, message, context }],
  };
}

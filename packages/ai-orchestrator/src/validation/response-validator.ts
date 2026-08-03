import type { ValidationResult, ValidationSchema } from '../types/validation.js';
import { extractJson } from '../utils/json.js';
import { matchSchema } from './schema.js';

export interface ResponseValidatorOptions {
  /** Require the payload to be an object (not a bare array/primitive). */
  requireObject?: boolean;
}

/**
 * Validates model output end-to-end: extract JSON from the raw text, then
 * match it against the expected schema. Every agent response must pass this
 * before execution proceeds.
 */
export class ResponseValidator {
  private readonly requireObject: boolean;

  constructor(options: ResponseValidatorOptions = {}) {
    this.requireObject = options.requireObject ?? true;
  }

  validate(
    text: string,
    schema?: ValidationSchema,
    options: ResponseValidatorOptions = {},
  ): ValidationResult {
    const requireObject = options.requireObject ?? this.requireObject;
    const extracted = extractJson(text);
    if (extracted === null) {
      return {
        ok: false,
        issues: [{ path: '$', message: 'response did not contain valid JSON' }],
        data: null,
        raw: text,
        schema: schema === undefined ? undefined : 'inline',
      };
    }

    const { data, raw } = extracted;
    const issues: { path: string; message: string }[] = [];

    if (requireObject && (data === null || typeof data !== 'object' || Array.isArray(data))) {
      issues.push({ path: '$', message: 'expected a JSON object at the root' });
    }

    if (schema !== undefined) {
      matchSchema(data, schema, '$', issues);
    }

    return {
      ok: issues.length === 0,
      issues,
      data,
      raw,
      schema: schema === undefined ? undefined : 'inline',
    };
  }
}

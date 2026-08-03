/**
 * Response validation types. Every agent response must pass schema
 * validation before execution; a failed validation produces a
 * {@link ValidationResult} describing every offending path.
 */

/** A minimal, JSON-serializable JSON-Schema subset with no external deps. */
export interface ValidationSchema {
  type?: 'object' | 'string' | 'number' | 'boolean' | 'array' | 'null';
  /** Required property names for `object`. */
  required?: string[];
  /** Per-property schemas for `object`. */
  properties?: Record<string, ValidationSchema>;
  /** Element schema for `array`. */
  items?: ValidationSchema;
  /** Enumerate the only allowed values. */
  enum?: unknown[];
  /** `string` length constraints. */
  minLength?: number;
  maxLength?: number;
  /** `number` range constraints. */
  minimum?: number;
  maximum?: number;
  /** `string` regex pattern (fully anchored). */
  pattern?: string;
  /** Disallow extra `object` properties beyond `properties`. */
  additionalProperties?: boolean;
}

export interface ValidationIssue {
  /** Dot-separated path to the offending value, e.g. `payload.title`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** The parsed value that was validated (null when parsing failed). */
  data: unknown;
  /** Raw text the value was parsed from, when applicable. */
  raw?: string;
  /** Schema name the response was validated against, when applicable. */
  schema?: string;
}

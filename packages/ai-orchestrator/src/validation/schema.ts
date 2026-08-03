import type { ValidationIssue, ValidationSchema } from '../types/validation.js';

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}...` : value);
  return String(value);
}

/**
 * Validates a value against the minimal JSON-Schema subset. Pure and
 * deterministic; returns every violation rather than failing fast.
 */
export function matchSchema(
  value: unknown,
  schema: ValidationSchema,
  path = '$',
  issues: ValidationIssue[] = [],
): ValidationIssue[] {
  const expected = schema.type;
  if (expected !== undefined && typeName(value) !== expected) {
    issues.push({
      path,
      message: `expected ${expected}, got ${typeName(value)}`,
    });
    return issues;
  }

  if (schema.enum !== undefined) {
    const allowed = schema.enum.some((candidate) => candidate === value);
    if (!allowed) {
      issues.push({ path, message: `value ${describeValue(value)} is not in the allowed set` });
    }
  }

  if (expected === 'string' && typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push({ path, message: `must be at least ${schema.minLength} characters` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push({ path, message: `must be at most ${schema.maxLength} characters` });
    }
    if (schema.pattern !== undefined) {
      const anchored = new RegExp(`^(?:${schema.pattern})$`);
      if (!anchored.test(value)) {
        issues.push({ path, message: `does not match pattern ${schema.pattern}` });
      }
    }
  }

  if (expected === 'number' && typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push({ path, message: `must be >= ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push({ path, message: `must be <= ${schema.maximum}` });
    }
  }

  if (expected === 'array' && Array.isArray(value)) {
    if (schema.items !== undefined) {
      for (let i = 0; i < value.length; i += 1) {
        matchSchema(value[i], schema.items, `${path}[${i}]`, issues);
      }
    }
  }

  if (expected === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const schemaProps = schema.properties ?? {};
    if (schema.required !== undefined) {
      for (const key of schema.required) {
        if (!(key in record)) {
          issues.push({ path: `${path}.${key}`, message: 'is required' });
        }
      }
    }
    for (const [key, childSchema] of Object.entries(schemaProps)) {
      if (key in record) {
        matchSchema(record[key], childSchema, `${path}.${key}`, issues);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in schemaProps)) {
          issues.push({ path: `${path}.${key}`, message: 'is not allowed' });
        }
      }
    }
  }

  return issues;
}

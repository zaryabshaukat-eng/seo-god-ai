import type { JsonSchema, SchemaProperty, SchemaType } from '../types/schema.js';

export interface SchemaViolation {
  path: string;
  message: string;
}

function violation(path: string, message: string): SchemaViolation {
  return { path, message };
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: unknown, type: SchemaType): boolean {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  return typeof value === type;
}

/**
 * Validates an arbitrary value against the minimal JSON-schema subset used by
 * the agents package. Deterministic and dependency-free.
 */
export function validateSchema(value: unknown, schema: JsonSchema): SchemaViolation[] {
  return validateProperty(value, schema, '$');
}

function isArrayType(value: SchemaType | readonly SchemaType[]): value is readonly SchemaType[] {
  return Array.isArray(value);
}

function validateProperty(value: unknown, property: SchemaProperty, path: string): SchemaViolation[] {
  const type = property.type;
  if (type === undefined) {
    return [];
  }
  if (isArrayType(type)) {
    const matched = type.find((candidate) => matchesType(value, candidate));
    if (matched === undefined) {
      return [
        violation(path, `expected one of ${type.join(', ')}, got ${describe(value)}`),
      ];
    }
    return validateTypedValue(value, property, path, matched);
  }
  return validateTypedValue(value, property, path, type);
}

function validateTypedValue(
  value: unknown,
  property: SchemaProperty,
  path: string,
  type: SchemaType,
): SchemaViolation[] {
  if (type === 'null') {
    return value === null ? [] : [violation(path, `expected null, got ${describe(value)}`)];
  }
  if (type === 'object') {
    if (!matchesType(value, type)) {
      return [violation(path, `expected object, got ${describe(value)}`)];
    }
    return validateObject(value as Record<string, unknown>, property, path);
  }
  if (type === 'array') {
    if (!Array.isArray(value)) {
      return [violation(path, `expected array, got ${describe(value)}`)];
    }
    if (property.items === undefined) {
      return [];
    }
    return value.flatMap((item, index) =>
      validateProperty(item, property.items as SchemaProperty, `${path}[${index}]`),
    );
  }
  if (!matchesType(value, type)) {
    return [violation(path, `expected ${type}, got ${describe(value)}`)];
  }
  const violations: SchemaViolation[] = [];
  if (type === 'string') {
    const text = value as string;
    if (property.minLength !== undefined && text.length < property.minLength) {
      violations.push(violation(path, `must be at least ${property.minLength} characters`));
    }
    if (property.maxLength !== undefined && text.length > property.maxLength) {
      violations.push(violation(path, `must be at most ${property.maxLength} characters`));
    }
    if (property.pattern !== undefined && new RegExp(property.pattern).test(text) === false) {
      violations.push(violation(path, `must match ${property.pattern}`));
    }
  } else if (type === 'number') {
    const number = value as number;
    if (property.minimum !== undefined && number < property.minimum) {
      violations.push(violation(path, `must be >= ${property.minimum}`));
    }
    if (property.maximum !== undefined && number > property.maximum) {
      violations.push(violation(path, `must be <= ${property.maximum}`));
    }
  }
  if (property.enum !== undefined && !property.enum.includes(value as string | number | boolean)) {
    violations.push(violation(path, `must be one of ${property.enum.join(', ')}`));
  }
  return violations;
}

function validateObject(
  value: Record<string, unknown>,
  property: SchemaProperty,
  path: string,
): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  for (const key of property.required ?? []) {
    if (!(key in value)) {
      violations.push(violation(`${path}.${key}`, 'required property missing'));
    }
  }
  if (property.additionalProperties === false) {
    const allowed = new Set(Object.keys(property.properties ?? {}));
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        violations.push(violation(`${path}.${key}`, 'unknown property'));
      }
    }
  }
  for (const [key, child] of Object.entries(property.properties ?? {})) {
    if (!(key in value)) {
      continue;
    }
    violations.push(...validateProperty(value[key], child, `${path}.${key}`));
  }
  return violations;
}

export function isValid(value: unknown, schema: JsonSchema): boolean {
  return validateSchema(value, schema).length === 0;
}

export function firstMessage(value: unknown, schema: JsonSchema): string | undefined {
  const violations = validateSchema(value, schema);
  return violations[0]?.message;
}

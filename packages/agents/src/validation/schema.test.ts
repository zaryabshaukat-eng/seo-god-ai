import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '../types/schema.js';
import { firstMessage, isValid, validateSchema } from './schema.js';

describe('validateSchema', () => {
  it('accepts a fully valid object', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', minLength: 1 } },
    };
    expect(validateSchema({ name: 'Acme' }, schema)).toEqual([]);
    expect(isValid({ name: 'Acme' }, schema)).toBe(true);
  });

  it('flags a missing required property', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    };
    expect(validateSchema({}, schema)).toEqual([
      { path: '$.name', message: 'required property missing' },
    ]);
  });

  it('rejects additional properties when disallowed', () => {
    const schema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
      properties: { name: { type: 'string' } },
    };
    expect(validateSchema({ name: 'Acme', extra: 1 }, schema)).toEqual([
      { path: '$.extra', message: 'unknown property' },
    ]);
  });

  it('validates nested objects and arrays', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'number', minimum: 0 } },
        meta: { type: 'object', properties: { ok: { type: 'boolean' } } },
      },
    };
    expect(validateSchema({ items: [1, -2], meta: { ok: 'yes' } }, schema)).toEqual([
      { path: '$.items[1]', message: 'must be >= 0' },
      { path: '$.meta.ok', message: 'expected boolean, got string' },
    ]);
  });

  it('handles union types and matches a valid branch', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { value: { type: ['string', 'number'] } },
    };
    expect(isValid({ value: 42 }, schema)).toBe(true);
    expect(isValid({ value: 'x' }, schema)).toBe(true);
    expect(validateSchema({ value: true }, schema)).toEqual([
      { path: '$.value', message: 'expected one of string, number, got boolean' },
    ]);
  });

  it('enforces enum, string length and pattern constraints', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['a', 'b'] },
        short: { type: 'string', maxLength: 3 },
        slug: { type: 'string', pattern: '^[a-z]+$' },
      },
    };
    const violations = validateSchema({ kind: 'c', short: 'toolong', slug: 'Bad' }, schema);
    expect(violations).toContainEqual({
      path: '$.kind',
      message: 'must be one of a, b',
    });
    expect(violations).toContainEqual({
      path: '$.short',
      message: 'must be at most 3 characters',
    });
    expect(violations).toContainEqual({ path: '$.slug', message: 'must match ^[a-z]+$' });
  });

  it('enforces numeric bounds', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { score: { type: 'number', minimum: 0, maximum: 100 } },
    };
    expect(validateSchema({ score: 150 }, schema)).toEqual([
      { path: '$.score', message: 'must be <= 100' },
    ]);
  });

  it('validates null and rejects wrong scalar types', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        maybe: { type: 'null' },
        flag: { type: 'boolean' },
      },
    };
    expect(isValid({ maybe: null, flag: false }, schema)).toBe(true);
    expect(validateSchema({ maybe: 1 }, schema)).toEqual([
      { path: '$.maybe', message: 'expected null, got number' },
    ]);
  });

  it('rejects arrays for object-typed properties', () => {
    const schema: JsonSchema = { type: 'object', properties: { meta: { type: 'object' } } };
    expect(validateSchema({ meta: [] }, schema)).toEqual([
      { path: '$.meta', message: 'expected object, got array' },
    ]);
  });

  it('accepts arrays without an items definition', () => {
    const schema: JsonSchema = { type: 'object', properties: { tags: { type: 'array' } } };
    expect(validateSchema({ tags: [1, 'x'] }, schema)).toEqual([]);
  });

  it('skips validation when no type is declared', () => {
    expect(validateSchema({ x: 'anything' }, { type: 'object', properties: { x: {} } })).toEqual([]);
  });

  it('firstMessage returns the first failure message', () => {
    const schema: JsonSchema = { type: 'object', required: ['x'], properties: { x: { type: 'string' } } };
    expect(firstMessage({}, schema)).toBe('required property missing');
    expect(firstMessage({ x: 'ok' }, schema)).toBeUndefined();
  });

  it('rejects non-object roots', () => {
    const schema: JsonSchema = { type: 'object' };
    expect(validateSchema('nope', schema)).toEqual([
      { path: '$', message: 'expected object, got string' },
    ]);
  });
});

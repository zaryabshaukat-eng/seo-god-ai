import { describe, expect, it } from 'vitest';
import type { ValidationSchema } from '../types/validation.js';
import { matchSchema } from './schema.js';
import { ResponseValidator } from './response-validator.js';

describe('matchSchema', () => {
  it('accepts a value that matches the schema', () => {
    const schema: ValidationSchema = {
      type: 'object',
      required: ['action'],
      properties: { action: { type: 'string', enum: ['update_title'] } },
    };
    expect(matchSchema({ action: 'update_title' }, schema)).toEqual([]);
  });

  it('reports type mismatches', () => {
    expect(matchSchema(42, { type: 'string' })).toHaveLength(1);
  });

  it('enforces enum membership', () => {
    expect(matchSchema('delete_page', { type: 'string', enum: ['update_title'] })).toHaveLength(1);
  });

  it('describes enum violations with long and non-string values', () => {
    expect(matchSchema('x'.repeat(60), { enum: ['a'] })).toHaveLength(1);
    expect(matchSchema(true, { enum: [1] })).toHaveLength(1);
  });

  it('enforces string lengths and patterns', () => {
    expect(matchSchema('a', { type: 'string', minLength: 2 })).toHaveLength(1);
    expect(matchSchema('abcdef', { type: 'string', maxLength: 3 })).toHaveLength(1);
    expect(matchSchema('ab', { type: 'string', pattern: 'ab' })).toEqual([]);
    expect(matchSchema('xyz', { type: 'string', pattern: 'ab' })).toHaveLength(1);
  });

  it('enforces number ranges', () => {
    expect(matchSchema(1, { type: 'number', minimum: 2 })).toHaveLength(1);
    expect(matchSchema(5, { type: 'number', maximum: 3 })).toHaveLength(1);
    expect(matchSchema(2, { type: 'number', minimum: 1, maximum: 3 })).toEqual([]);
  });

  it('validates array items', () => {
    expect(matchSchema([1, 2], { type: 'array', items: { type: 'number' } })).toEqual([]);
    expect(matchSchema([1, 'x'], { type: 'array', items: { type: 'number' } })).toHaveLength(1);
  });

  it('requires declared properties and rejects extra ones', () => {
    const schema: ValidationSchema = {
      type: 'object',
      required: ['action'],
      properties: { action: { type: 'string' } },
      additionalProperties: false,
    };
    expect(matchSchema({ title: 'x' }, schema)).toEqual([
      expect.objectContaining({ path: '$.action', message: 'is required' }),
      expect.objectContaining({ path: '$.title', message: 'is not allowed' }),
    ]);
  });

  it('descends into nested objects with path tracking', () => {
    const schema: ValidationSchema = {
      type: 'object',
      properties: { payload: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
    };
    const issues = matchSchema({ payload: {} }, schema);
    expect(issues[0]?.path).toBe('$.payload.id');
  });
});

describe('ResponseValidator', () => {
  it('validates clean JSON against a schema', () => {
    const result = new ResponseValidator().validate('{"action":"update_title","resourceId":"/p/1"}', {
      type: 'object',
      required: ['action', 'resourceId'],
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ action: 'update_title', resourceId: '/p/1' });
    expect(result.schema).toBe('inline');
  });

  it('rejects text without JSON', () => {
    const result = new ResponseValidator().validate('no json');
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain('valid JSON');
  });

  it('rejects non-object roots when requireObject is set', () => {
    const result = new ResponseValidator().validate('[1,2]');
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain('object at the root');
  });

  it('allows non-object roots when requireObject is disabled', () => {
    const result = new ResponseValidator().validate('[1,2]', undefined, { requireObject: false });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([1, 2]);
  });

  it('collects schema violations', () => {
    const result = new ResponseValidator().validate('{"action":"delete_page"}', {
      type: 'object',
      required: ['action'],
      properties: { action: { type: 'string', enum: ['update_title'] } },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { sanitizeMetadata } from './sanitize.js';
import { validateEdgeInput, validateNodeInput } from './validation.js';
import type { EdgeInput, NodeInput } from '../types/graph.js';

describe('sanitizeMetadata', () => {
  it('deep-copies plain metadata', () => {
    const input = { title: 'x', nested: { a: 1, list: ['y', true] }, when: new Date('2026-01-01') };
    const out = sanitizeMetadata(input);
    expect(out).toEqual({ title: 'x', nested: { a: 1, list: ['y', true] }, when: '2026-01-01T00:00:00.000Z' });
    expect(out).not.toBe(input);
    expect((out.nested as Record<string, unknown>)?.a).toBe(1);
  });

  it('strips sensitive keys', () => {
    const out = sanitizeMetadata({
      accessToken: 'secret',
      api_key: 'secret',
      Authorization: 'Bearer x',
      title: 'ok',
    });
    expect(out).toEqual({ title: 'ok' });
  });

  it('rejects non-object input', () => {
    expect(() => sanitizeMetadata('nope')).toThrow(/plain object/);
    expect(() => sanitizeMetadata([1, 2])).toThrow(/plain object/);
    expect(() => sanitizeMetadata(null)).toThrow(/plain object/);
  });

  it('rejects functions, symbols, bigints and cycles', () => {
    expect(() => sanitizeMetadata({ f: () => undefined })).toThrow(/non-serializable/);
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic.self = cyclic;
    expect(() => sanitizeMetadata(cyclic)).toThrow(/cycle/);
  });

  it('caps array lengths and entry counts', () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 1500; i += 1) big[`k${i}`] = i;
    const out = sanitizeMetadata(big);
    expect(Object.keys(out).length).toBe(1000);
    const arr = sanitizeMetadata({ list: Array.from({ length: 1500 }, (_, i) => i) });
    expect((arr.list as number[]).length).toBe(1000);
  });

  it('flattens undefined to null inside objects', () => {
    expect(sanitizeMetadata({ a: undefined })).toEqual({ a: null });
  });

  it('rejects metadata that exceeds maximum nesting depth', () => {
    expect(() => sanitizeMetadata({ a: 1 }, { depth: 7 })).toThrow(/nesting depth/);
    const nested: Record<string, unknown> = { a: {} };
    let cursor = nested.a as Record<string, unknown>;
    for (let i = 0; i < 10; i += 1) {
      cursor.b = {};
      cursor = cursor.b as Record<string, unknown>;
    }
    expect(() => sanitizeMetadata(nested)).toThrow(/nesting depth/);
  });

  it('strips sensitive keys and caps entries inside nested objects', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 1500; i += 1) big[`k${i}`] = i;
    const out = sanitizeMetadata({ outer: { api_key: 'secret', password: 'x', ...big } });
    const outer = out.outer as Record<string, number>;
    expect(outer).not.toHaveProperty('api_key');
    expect(outer).not.toHaveProperty('password');
    expect(Object.keys(outer).length).toBe(1000);
  });
});

describe('validateNodeInput', () => {
  const valid = { type: 'page' as const, externalId: 'x', source: 'crawler' };
  it('accepts valid input', () => {
    expect(() => validateNodeInput(valid)).not.toThrow();
    expect(() => validateNodeInput({ ...valid, name: 'N', properties: { a: 1 } })).not.toThrow();
  });
  it('rejects invalid type', () => {
    expect(() => validateNodeInput({ ...valid, type: 'bogus' } as unknown as NodeInput)).toThrow(/type/);
  });
  it('rejects empty externalId', () => {
    expect(() => validateNodeInput({ ...valid, externalId: '' })).toThrow(/externalId/);
  });
  it('rejects empty source', () => {
    expect(() => validateNodeInput({ ...valid, source: ' ' })).toThrow(/source/);
  });
  it('rejects non-string name', () => {
    expect(() => validateNodeInput({ ...valid, name: 3 } as unknown as NodeInput)).toThrow(/name/);
  });
});

describe('validateEdgeInput', () => {
  const valid = { type: 'links_to' as const, from: 'a', to: 'b', source: 'crawler' };
  it('accepts valid input', () => {
    expect(() => validateEdgeInput(valid)).not.toThrow();
    expect(() => validateEdgeInput({ ...valid, weight: 0.5, confidence: 0.9 })).not.toThrow();
  });
  it('rejects invalid type and endpoints', () => {
    expect(() => validateEdgeInput({ ...valid, type: 'nope' } as unknown as EdgeInput)).toThrow(/type/);
    expect(() => validateEdgeInput({ ...valid, from: '' })).toThrow(/from/);
    expect(() => validateEdgeInput({ ...valid, to: '' })).toThrow(/to/);
  });
  it('rejects self-referencing edges', () => {
    expect(() => validateEdgeInput({ ...valid, from: 'a', to: 'a' })).toThrow(/Self-referencing/);
  });
  it('rejects empty provenance source', () => {
    expect(() => validateEdgeInput({ ...valid, source: '' })).toThrow(/source/);
  });
  it('rejects invalid weights and confidence', () => {
    expect(() => validateEdgeInput({ ...valid, weight: -1 })).toThrow(/weight/);
    expect(() => validateEdgeInput({ ...valid, weight: Number.NaN })).toThrow(/weight/);
    expect(() => validateEdgeInput({ ...valid, confidence: 1.5 })).toThrow(/confidence/);
    expect(() => validateEdgeInput({ ...valid, confidence: -0.1 })).toThrow(/confidence/);
  });
});

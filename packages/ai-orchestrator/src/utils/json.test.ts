import { describe, expect, it } from 'vitest';
import { extractJson, parseJson, stableStringify } from './json.js';

describe('parseJson', () => {
  it('parses valid JSON and returns null for invalid input', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('nonsense')).toBeNull();
    expect(parseJson('')).toBeNull();
  });
});

describe('extractJson', () => {
  it('returns direct JSON untouched', () => {
    const result = extractJson('{"action":"update_title"}');
    expect(result?.data).toEqual({ action: 'update_title' });
    expect(result?.raw).toBe('{"action":"update_title"}');
  });

  it('extracts JSON wrapped in fenced code blocks', () => {
    const result = extractJson('Here you go:\n```json\n{"a":1}\n```\nthanks');
    expect(result?.data).toEqual({ a: 1 });
    expect(result?.raw).toBe('{"a":1}');
  });

  it('extracts JSON that follows prose (inline/array)', () => {
    const result = extractJson('Result: [1, 2, 3]');
    expect(result?.data).toEqual([1, 2, 3]);
  });

  it('extracts an inline object when no array is present', () => {
    const result = extractJson('Answer: {"a":1}');
    expect(result?.data).toEqual({ a: 1 });
    expect(result?.raw).toBe('{"a":1}');
  });

  it('returns null when nothing parseable exists', () => {
    expect(extractJson('no json at all')).toBeNull();
    expect(extractJson('```\nnot json\n```')).toBeNull();
  });
});

describe('stableStringify', () => {
  it('sorts keys recursively and drops whitespace', () => {
    expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
    expect(stableStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
    expect(stableStringify('plain')).toBe('"plain"');
  });
});

import { describe, expect, it } from 'vitest';
import { clamp, slugify, truncate, wordCount } from './text.js';

describe('text utils', () => {
  it('truncate keeps short text unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncate appends an ellipsis to long text', () => {
    const result = truncate('abcdefghij', 5);
    expect(result).toBe('abcd\u2026');
    expect(result.length).toBe(5);
  });

  it('truncate handles zero-length edge case', () => {
    expect(truncate('abc', 0)).toBe('\u2026');
  });

  it('wordCount counts words and trims whitespace', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
    expect(wordCount('one two three')).toBe(3);
    expect(wordCount('  spaced   text  ')).toBe(2);
  });

  it('slugify lowercases and replaces separators', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('  Title!! $Foo  ')).toBe('title-foo');
    expect(slugify('')).toBe('');
  });

  it('clamp bounds values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

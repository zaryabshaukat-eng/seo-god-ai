import { describe, expect, it } from 'vitest';
import { CopilotValidationError } from './errors.js';
import {
  assertMessage,
  assertTenant,
  isBlank,
  newCopilotId,
  parseToolArguments,
  positiveInt,
  timestamp,
  windowMessages,
} from './utils.js';

describe('newCopilotId', () => {
  it('returns a namespaced unique id', () => {
    const a = newCopilotId('conv');
    const b = newCopilotId('conv');
    expect(a).toMatch(/^conv_[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });
});

describe('timestamp', () => {
  it('delegates to the injected clock', () => {
    expect(timestamp(() => '2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('assertTenant', () => {
  it('accepts a valid tenant id', () => {
    expect(() => assertTenant('tenant_1')).not.toThrow();
  });

  it('rejects empty and blank tenant ids', () => {
    expect(() => assertTenant('')).toThrow(CopilotValidationError);
    expect(() => assertTenant('   ')).toThrow(CopilotValidationError);
  });
});

describe('assertMessage', () => {
  it('accepts a valid message', () => {
    expect(() => assertMessage('hello')).not.toThrow();
  });

  it('rejects empty and blank messages', () => {
    expect(() => assertMessage('')).toThrow(CopilotValidationError);
    expect(() => assertMessage('\n\t')).toThrow(CopilotValidationError);
  });
});

describe('positiveInt', () => {
  it('returns the fallback for non-finite input', () => {
    expect(positiveInt(undefined, 5, 0, 10)).toBe(5);
    expect(positiveInt('abc', 5, 0, 10)).toBe(5);
    expect(positiveInt(Number.NaN, 5, 0, 10)).toBe(5);
    expect(positiveInt(Number.POSITIVE_INFINITY, 5, 0, 10)).toBe(5);
  });

  it('clamps below and above the bounds', () => {
    expect(positiveInt(-3, 5, 0, 10)).toBe(0);
    expect(positiveInt(99, 5, 0, 10)).toBe(10);
  });

  it('floors and passes through valid numbers', () => {
    expect(positiveInt(7.9, 5, 0, 10)).toBe(7);
    expect(positiveInt('4', 5, 0, 10)).toBe(4);
  });
});

describe('windowMessages', () => {
  const system = { role: 'system' as const, content: 'sys' };
  const messages = [
    { role: 'user' as const, content: 'u1' },
    { role: 'assistant' as const, content: 'a1' },
    { role: 'user' as const, content: 'u2' },
    { role: 'assistant' as const, content: 'a2' },
  ];

  it('returns empty for no messages', () => {
    expect(windowMessages([], 10)).toEqual([]);
  });

  it('keeps the system head and the last N messages', () => {
    const result = windowMessages([system, ...messages], 2);
    expect(result).toEqual([system, { role: 'user', content: 'u2' }, { role: 'assistant', content: 'a2' }]);
  });

  it('drops everything when history is zero', () => {
    expect(windowMessages([system, ...messages], 0)).toEqual([system]);
  });

  it('handles conversations without a system head', () => {
    expect(windowMessages(messages, 1)).toEqual([{ role: 'assistant', content: 'a2' }]);
  });
});

describe('parseToolArguments', () => {
  it('returns empty object for empty input', () => {
    expect(parseToolArguments('')).toEqual({});
    expect(parseToolArguments('   ')).toEqual({});
  });

  it('parses valid JSON objects', () => {
    expect(parseToolArguments('{"storeId":"s1"}')).toEqual({ storeId: 's1' });
  });

  it('returns empty object for invalid or non-object JSON', () => {
    expect(parseToolArguments('{oops')).toEqual({});
    expect(parseToolArguments('"string"')).toEqual({});
    expect(parseToolArguments('[1,2]')).toEqual({});
    expect(parseToolArguments('null')).toEqual({});
  });
});

describe('isBlank', () => {
  it('detects blank values', () => {
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank('')).toBe(true);
    expect(isBlank('   ')).toBe(true);
    expect(isBlank('x')).toBe(false);
  });
});

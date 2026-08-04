import { describe, expect, it } from 'vitest';
import { deterministicUuid, isUuid, newId } from './ids.js';

describe('ids', () => {
  it('deterministicUuid is stable per input and distinct across inputs', () => {
    const a = deterministicUuid('store-1', 'task-1');
    const b = deterministicUuid('store-1', 'task-1');
    const c = deterministicUuid('store-1', 'task-2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(isUuid(a)).toBe(true);
  });

  it('newId returns unique v4-style uuids', () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(isUuid(a)).toBe(true);
    expect(isUuid(b)).toBe(true);
  });

  it('isUuid rejects malformed values', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid('00000000-0000-0000-0000-00000000000Z')).toBe(false);
  });
});

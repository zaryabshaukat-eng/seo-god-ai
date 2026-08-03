import { describe, expect, it } from 'vitest';
import { deterministicUuid, isUuid, newId } from './ids.js';

describe('deterministicUuid', () => {
  it('is stable for identical namespace and name', () => {
    expect(deterministicUuid('decision', 'store-1|rec-1')).toBe(
      deterministicUuid('decision', 'store-1|rec-1'),
    );
  });

  it('differs when the namespace or name changes', () => {
    expect(deterministicUuid('decision', 'store-1|rec-1')).not.toBe(
      deterministicUuid('execution-plan', 'store-1|rec-1'),
    );
    expect(deterministicUuid('decision', 'store-1|rec-1')).not.toBe(
      deterministicUuid('decision', 'store-1|rec-2'),
    );
  });

  it('emits a well-formed UUID', () => {
    const id = deterministicUuid('task', 'a\u0000b');
    expect(isUuid(id)).toBe(true);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('newId', () => {
  it('returns unique UUIDs', () => {
    expect(newId()).not.toBe(newId());
    expect(isUuid(newId())).toBe(true);
  });
});

describe('isUuid', () => {
  it('accepts valid UUIDs', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('rejects non-UUIDs', () => {
    expect(isUuid('')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('123e4567-e89b-12d3-a456-42661417400z')).toBe(false);
  });
});

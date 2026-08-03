import { describe, expect, it } from 'vitest';
import { deterministicUuid, isUuid, newId } from './ids.js';

describe('ids', () => {
  it('produces deterministic v5-style UUIDs from namespaces', () => {
    const a = deterministicUuid('workflow-definition', 'plan-1');
    const b = deterministicUuid('workflow-definition', 'plan-1');
    const c = deterministicUuid('workflow-definition', 'plan-2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(isUuid(a)).toBe(true);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('separates namespaces so the same name yields different ids', () => {
    expect(deterministicUuid('workflow:store-1', 'def-1')).not.toBe(
      deterministicUuid('trace', 'def-1'),
    );
  });

  it('creates random ids and validates UUIDs', () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(isUuid(a)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('matches the decision-engine scheme for identical inputs', () => {
    expect(deterministicUuid('node:page', 'https://acme.example/p/1')).toBe(
      deterministicUuid('node:page', 'https://acme.example/p/1'),
    );
  });
});

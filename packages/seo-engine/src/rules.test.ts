import { describe, expect, it } from 'vitest';
import {
  FALLBACK_RULE_META,
  constraintsFor,
  metaForRule,
  ruleRegistry,
} from './rules.js';

describe('rules registry', () => {
  it('returns metadata for known rules', () => {
    const meta = metaForRule('missing-title');
    expect(meta.rule).toBe('missing-title');
    expect(meta.category).toBe('content');
    expect(meta.impact).toBe('HIGH');
    expect(meta.moneyPages).toBe(true);
  });

  it('falls back deterministically for unknown rules', () => {
    const meta = metaForRule('unknown-rule');
    expect(meta).toEqual({ ...FALLBACK_RULE_META, rule: 'unknown-rule' });
  });

  it('exposes the full registry', () => {
    const registry = ruleRegistry();
    expect(registry).toHaveLength(23);
    expect(registry.map((meta) => meta.rule)).toContain('invalid-structured-data');
    expect(registry.every((meta) => meta.rule === meta.rule)).toBe(true);
  });

  it('returns category constraints', () => {
    const constraints = constraintsFor('content');
    expect(constraints).toHaveLength(2);
    expect(constraints[0]).toBe('Only act on the pages listed in affectedUrls.');
    expect(constraints[1]).toContain('unique');
  });
});

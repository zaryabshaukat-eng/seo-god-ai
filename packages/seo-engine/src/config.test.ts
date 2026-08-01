import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING,
  DEFAULT_THRESHOLDS,
  defaultEnabledRules,
  resolveConfig,
} from './config.js';
import { ruleRegistry } from './rules.js';

describe('config', () => {
  it('resolves defaults for an empty config', () => {
    const config = resolveConfig();
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(config.scoring).toEqual(DEFAULT_SCORING);
    expect(config.rules.size).toBe(0);
    expect(config.maxRecommendationsPerCategory).toBeNull();
    expect(config.clock()).toBeInstanceOf(Date);
  });

  it('merges partial thresholds and scoring', () => {
    const config = resolveConfig({
      thresholds: { slowTtfbMs: 2000 },
      scoring: { impactWeight: 0.6 },
    });
    expect(config.thresholds.slowTtfbMs).toBe(2000);
    expect(config.thresholds.largeHtmlBytes).toBe(DEFAULT_THRESHOLDS.largeHtmlBytes);
    expect(config.scoring.impactWeight).toBe(0.6);
    expect(config.scoring.confidenceWeight).toBe(DEFAULT_SCORING.confidenceWeight);
  });

  it('builds rule overrides with default-enabled semantics', () => {
    const config = resolveConfig({
      rules: {
        'missing-title': { impact: 'LOW' },
        'broken-link': { enabled: false },
        'thin-content': { effort: 'LOW' },
      },
    });
    expect(config.rules.get('missing-title')).toEqual({ enabled: true, impact: 'LOW', effort: undefined });
    expect(config.rules.get('broken-link')).toEqual({ enabled: false });
    expect(config.rules.get('thin-content')?.effort).toBe('LOW');
  });

  it('resolves category cap and a custom clock', () => {
    const fixed = new Date('2026-01-01T00:00:00Z');
    const config = resolveConfig({ maxRecommendationsPerCategory: 3, clock: () => fixed });
    expect(config.maxRecommendationsPerCategory).toBe(3);
    expect(config.clock()).toBe(fixed);
  });

  it('defaultEnabledRules matches the registry keys', () => {
    const registered = ruleRegistry().map((meta) => meta.rule).sort();
    expect([...defaultEnabledRules()].sort()).toEqual(registered);
    expect(defaultEnabledRules()).toHaveLength(23);
  });
});

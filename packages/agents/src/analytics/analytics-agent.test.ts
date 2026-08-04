import { describe, expect, it } from 'vitest';
import { AnalyticsAgent } from './analytics-agent.js';
import { makeInput } from '../test/helpers.js';

function run(context: Record<string, unknown>) {
  return new AnalyticsAgent().analyze(makeInput({ context }));
}

function rulesOf(result: ReturnType<AnalyticsAgent['analyze']>): string[] {
  return result.recommendations.map((recommendation) => recommendation.rule);
}

describe('AnalyticsAgent', () => {
  it('flags low CTR pages', () => {
    const out = run({ outcomes: [{ url: '/p/1', impressions: 1000, clicks: 5 }] });
    expect(rulesOf(out)).toContain('analytics.low-ctr');
  });

  it('flags low visibility pages', () => {
    const out = run({ outcomes: [{ url: '/p/1', impressions: 10 }] });
    expect(rulesOf(out)).toContain('analytics.low-visibility');
  });

  it('flags pages ranking below the fold', () => {
    const out = run({ outcomes: [{ url: '/p/1', position: 15 }] });
    expect(rulesOf(out)).toContain('analytics.poor-ranking');
  });

  it('reads metrics from an analytics object with nested outcomes', () => {
    const out = run({ analytics: { outcomes: [{ url: '/p/1', impressions: 10 }] } });
    expect(rulesOf(out)).toContain('analytics.low-visibility');
  });

  it('uses the explicit ctr field when present', () => {
    const out = run({ outcomes: [{ url: '/p/1', ctr: 0.01 }] });
    expect(rulesOf(out)).toContain('analytics.low-ctr');
  });

  it('warns when no outcome data is provided', () => {
    const out = run({});
    expect(out.warnings).toContain('No outcome data was provided.');
    expect(out.recommendations).toHaveLength(0);
  });

  it('passes healthy metrics', () => {
    const out = run({ outcomes: [{ url: '/p/1', impressions: 10000, clicks: 500, position: 3 }] });
    expect(out.recommendations).toHaveLength(0);
  });

  it('skips metric records without a url', () => {
    const out = run({ outcomes: [{ impressions: 10 }, { url: '/p/1', impressions: 10 }] });
    expect(rulesOf(out)).toContain('analytics.low-visibility');
  });

  it('warns when the analytics object has no outcome data', () => {
    const out = run({ analytics: {} });
    expect(out.warnings).toContain('No outcome data was provided.');
  });
});

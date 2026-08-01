import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, SeoEngine, mergeByRule, recommendationId } from './engine.js';
import { engineInput, extraction, issue, page, perf, STATISTICS } from './test/fixtures.js';
import type { RecommendationCandidate } from './types.js';

function candidate(overrides: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  return {
    rule: 'missing-title',
    category: 'content',
    impact: 'HIGH',
    effort: 'LOW',
    confidence: 0.85,
    title: 'Add a unique page title',
    description: 'd',
    rationale: 'r',
    recommendedAction: 'a',
    evidence: [],
    affectedUrls: ['https://a.com'],
    pageCount: 1,
    occurrenceCount: 1,
    moneyPageAffected: false,
    ...overrides,
  };
}

describe('SeoEngine', () => {
  it('analyzes input into a fully-populated report', () => {
    const fixed = new Date('2026-01-01T00:00:00Z');
    const engine = new SeoEngine({ clock: () => fixed });
    const input = engineInput({
      pages: [
        page({ issues: [issue()] }),
        page({
          url: 'https://slow.example.com',
          extraction: extraction({
            url: 'https://slow.example.com',
            performance: perf({ ttfbMs: 2000 }),
          }),
          issues: [issue({ rule: 'missing-h1' })],
        }),
      ],
    });
    const report = engine.analyze(input);
    expect(report.crawlJobId).toBe('job-1');
    expect(report.storeId).toBe('store-1');
    expect(report.engineVersion).toBe(ENGINE_VERSION);
    expect(report.generatedAt).toBe(fixed);
    expect(report.statistics).toEqual(STATISTICS);
    expect(report.recommendations.length).toBeGreaterThanOrEqual(3);

    for (const recommendation of report.recommendations) {
      expect(recommendation.id).toMatch(/^[0-9a-f]{16}$/);
      expect(recommendation.affectedUrls).toEqual([...recommendation.affectedUrls].sort());
      expect(recommendation.aiContext.score).toBe(recommendation.score);
      expect(recommendation.aiContext.priority).toBe(recommendation.priority);
      expect(recommendation.aiContext.constraints.length).toBe(2);
      expect(recommendation.crawlJobId).toBe('job-1');
    }
  });

  it('sorts recommendations deterministically by priority and score', () => {
    const engine = new SeoEngine();
    const input = engineInput({
      pages: [
        page({ url: 'https://a.com', issues: [issue({ rule: 'broken-link', severity: 'CRITICAL' })] }),
        page({ url: 'https://b.com', issues: [issue({ rule: 'missing-alt-text' })] }),
      ],
    });
    const report = engine.analyze(input);
    const priorities = report.recommendations.map((r) => r.priority);
    const order = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 } as const;
    for (let i = 1; i < priorities.length; i++) {
      expect(order[priorities[i - 1]!]).toBeGreaterThanOrEqual(order[priorities[i]!]);
    }
  });

  it('produces identical output for identical input', () => {
    const engine = new SeoEngine({ clock: () => new Date(0) });
    const input = engineInput();
    const first = engine.analyze(input);
    const second = engine.analyze(input);
    expect(second).toEqual(first);
  });

  it('caps recommendations per category', () => {
    const engine = new SeoEngine({ maxRecommendationsPerCategory: 1 });
    const input = engineInput({
      pages: [
        page({ url: 'https://a.com', issues: [issue({ rule: 'missing-title' })] }),
        page({ url: 'https://b.com', issues: [issue({ rule: 'missing-h1' })] }),
      ],
    });
    const report = engine.analyze(input);
    const contentCount = report.summary.byCategory.content;
    expect(contentCount).toBe(1);
    expect(report.summary.total).toBe(report.recommendations.length);
  });

  it('honors disabled rules and reflects it in the summary', () => {
    const engine = new SeoEngine({ rules: { 'missing-title': { enabled: false } } });
    const report = engine.analyze(engineInput());
    expect(report.recommendations).toEqual([]);
    expect(report.summary.total).toBe(0);
    expect(report.summary.byPriority).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 });
  });

  it('builds a stable summary by priority and category', () => {
    const engine = new SeoEngine();
    const report = engine.analyze(engineInput());
    const total = Object.values(report.summary.byPriority).reduce((a, b) => a + b, 0);
    expect(total).toBe(report.recommendations.length);
    const categoryTotal = Object.values(report.summary.byCategory).reduce((a, b) => a + b, 0);
    expect(categoryTotal).toBe(report.recommendations.length);
  });
});

describe('recommendationId', () => {
  it('is a deterministic short sha256 and stable across calls', () => {
    const urls = ['https://b.com', 'https://a.com'];
    expect(recommendationId('missing-title', urls)).toBe(recommendationId('missing-title', urls));
    expect(recommendationId('missing-title', urls)).toHaveLength(16);
    expect(recommendationId('missing-title', urls)).not.toBe(recommendationId('missing-h1', urls));
    expect(recommendationId('missing-title', ['https://a.com'])).not.toBe(
      recommendationId('missing-title', ['https://a.com', 'https://b.com']),
    );
  });
});

describe('mergeByRule', () => {
  it('passes through single candidates unchanged', () => {
    const only = candidate();
    expect(mergeByRule([only])).toEqual([only]);
  });

  it('merges duplicates by rule, unioning evidence and keeping the best impact', () => {
    const input = [
      candidate({ rule: 'x', affectedUrls: ['https://a.com'], evidence: [{ url: 'https://a.com', field: 'f', value: 1 }], occurrenceCount: 1 }),
      candidate({ rule: 'x', impact: 'LOW', affectedUrls: ['https://b.com'], evidence: [{ url: 'https://b.com', field: 'f', value: 2 }], occurrenceCount: 2 }),
    ];
    const [merged] = mergeByRule(input);
    expect(merged!.affectedUrls).toEqual(['https://a.com', 'https://b.com']);
    expect(merged!.pageCount).toBe(2);
    expect(merged!.occurrenceCount).toBe(3);
    expect(merged!.impact).toBe('HIGH');
    expect(merged!.evidence).toHaveLength(2);
  });

  it('merges multiple candidates, keeping the lowest effort', () => {
    const [merged] = mergeByRule([
      candidate({ rule: 'x', effort: 'HIGH' }),
      candidate({ rule: 'x', effort: 'LOW' }),
      candidate({ rule: 'x', effort: 'MEDIUM' }),
    ]);
    expect(merged!.effort).toBe('LOW');
  });

  it('raises impact when a higher-impact candidate joins the group', () => {
    const [merged] = mergeByRule([
      candidate({ rule: 'x', impact: 'LOW' }),
      candidate({ rule: 'x', impact: 'HIGH' }),
    ]);
    expect(merged!.impact).toBe('HIGH');
  });

  it('keeps the lowest effort when a later candidate is easier', () => {
    const [merged] = mergeByRule([
      candidate({ rule: 'x', effort: 'LOW' }),
      candidate({ rule: 'x', effort: 'HIGH' }),
      candidate({ rule: 'x', effort: 'MEDIUM' }),
    ]);
    expect(merged!.effort).toBe('LOW');
  });
});

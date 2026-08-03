import { describe, expect, it } from 'vitest';
import { ContextBuilder, estimateTokens } from './context-builder.js';
import type { ContextSources } from '../types/context.js';

const sources: ContextSources = {
  storeId: 'store-1',
  storeMetadata: { name: 'Acme', domain: 'acme.example' },
  graph: {
    snapshotId: 'snap-1',
    pageCount: 10,
    orphanPages: [{ id: 'p1', url: '/p/1', type: 'page', inLinks: 0 }],
    topicClusters: [{ id: 'c1' }],
    contentGaps: [{ id: 'g1' }],
    duplicateTargets: [{ id: 'd1' }],
  },
  seoIssues: [{ url: '/p/1', rule: 'missing-title' }],
  recommendations: [
    { id: 'r1', rule: 'missing-title', priority: 'high', score: 90, title: 'Add title', description: 'd', recommendedAction: 'update_title', affectedUrls: ['/p/1'] },
  ],
  historicalOutcomes: [{ rule: 'missing-title', attempts: 3, successes: 2, averageImpact: 5 }],
  featureFlags: { beta: true },
  settings: { locale: 'en' },
};

describe('ContextBuilder', () => {
  it('estimates tokens as chars / 4', () => {
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens({ a: 1 })).toBe(2);
  });

  it('builds all sections in deterministic order', () => {
    const context = new ContextBuilder().build(sources, {
      task: { id: 'task-1', agentId: 'a', name: 'n', description: 'd' },
    });
    expect(context.storeId).toBe('store-1');
    expect(context.taskId).toBe('task-1');
    expect(context.agentId).toBe('a');
    expect(context.sections.map((section) => section.kind)).toEqual([
      'knowledge-graph',
      'seo-issues',
      'recommendations',
      'historical-outcomes',
      'store-metadata',
      'configuration',
      'task',
    ]);
    const graph = context.sections.find((s) => s.kind === 'knowledge-graph');
    expect((graph?.content as { snapshotId: string }).snapshotId).toBe('snap-1');
    const config = context.sections.find((s) => s.kind === 'configuration');
    expect(config?.content).toEqual({ featureFlags: { beta: true }, settings: { locale: 'en' } });
  });

  it('skips missing sections and null graph', () => {
    const context = new ContextBuilder().build({
      storeId: 'store-1',
      graph: null,
      recommendations: undefined,
    });
    const kinds = context.sections.map((section) => section.kind);
    expect(kinds).not.toContain('knowledge-graph');
    expect(kinds).not.toContain('recommendations');
    expect(kinds).not.toContain('configuration');
  });

  it('truncates array sections to the per-section budget', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      url: `/p/${i}`,
      rule: `rule-${i}`,
      message: `message number ${i}`,
    }));
    const context = new ContextBuilder().build(
      { storeId: 'store-1', seoIssues: many },
      { budget: { maxSectionTokens: 8 } },
    );
    const issues = context.sections.find((s) => s.kind === 'seo-issues');
    expect(issues?.truncated).toBe(true);
    expect(Array.isArray(issues?.content)).toBe(true);
    expect((issues?.content as unknown[]).length).toBeLessThan(many.length);
  });

  it('applies the global budget by clearing oversized array sections', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      url: `/p/${i}`,
      rule: `rule-${i}`,
      message: 'abcdefghijklmnopqrstuvwxyz',
    }));
    const context = new ContextBuilder().build(
      { storeId: 'store-1', seoIssues: many },
      { budget: { maxTokens: 2, maxSectionTokens: 0 } },
    );
    const issues = context.sections.find((s) => s.kind === 'seo-issues');
    expect(issues?.truncated).toBe(true);
    expect((issues?.content as unknown[]).length).toBe(0);
  });

  it('truncates array content to fit remaining global budget', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      url: `/p/${i}`,
      rule: `rule-${i}`,
      message: 'abcdefghijklmnopqrstuvwxyz',
    }));
    const context = new ContextBuilder().build(
      { storeId: 'store-1', seoIssues: many },
      { budget: { maxTokens: 100, maxSectionTokens: 0 } },
    );
    const issues = context.sections.find((s) => s.kind === 'seo-issues');
    expect(issues?.truncated).toBe(true);
    expect((issues?.content as unknown[]).length).toBeLessThan(many.length);
  });

  it('truncates array content to a tight global budget', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      url: `/p/${i}`,
      rule: `r${i}`,
      message: 'abcd',
    }));
    const context = new ContextBuilder().build(
      { storeId: 'store-1', seoIssues: many },
      { budget: { maxTokens: 12, maxSectionTokens: 0 } },
    );
    const issues = context.sections.find((s) => s.kind === 'seo-issues');
    expect(issues?.truncated).toBe(true);
    expect((issues?.content as unknown[]).length).toBeLessThan(many.length);
  });

  it('leaves sections untouched when no budget is set', () => {
    const context = new ContextBuilder().build(sources);
    expect(context.sections.every((section) => section.truncated === false)).toBe(true);
    expect(context.sections.length).toBeGreaterThan(0);
  });

  it('builds configuration from settings only', () => {
    const context = new ContextBuilder().build({
      storeId: 'store-1',
      settings: { locale: 'en' },
    });
    const config = context.sections.find((s) => s.kind === 'configuration');
    expect(config?.content).toEqual({ settings: { locale: 'en' } });
  });

  it('builds configuration from feature flags only', () => {
    const context = new ContextBuilder().build({
      storeId: 'store-1',
      featureFlags: { beta: true },
    });
    const config = context.sections.find((s) => s.kind === 'configuration');
    expect(config?.content).toEqual({ featureFlags: { beta: true } });
  });

  it('clears oversized array sections when other sections exceed the budget', () => {
    const issues = Array.from({ length: 5 }, (_, i) => ({
      url: `/p/${i}`,
      rule: `r${i}`,
      message: 'abcdefghijklmnopqrstuvwxyz',
    }));
    const recommendations = Array.from({ length: 5 }, (_, i) => ({
      id: `rec-${i}`,
      rule: 'missing-title',
      priority: 'high',
      score: 90 - i,
      title: 'Add title',
      description: 'd',
      recommendedAction: 'update_title',
      affectedUrls: ['/p/1'],
    }));
    const context = new ContextBuilder().build(
      {
        storeId: 'store-1',
        graph: {
          snapshotId: 'snap-1',
          pageCount: 10,
          orphanPages: [{ id: 'p1', url: '/p/1', type: 'page', inLinks: 0 }],
          topicClusters: [{ id: 'c1' }],
          contentGaps: [{ id: 'g1' }],
          duplicateTargets: [{ id: 'd1' }],
        },
        seoIssues: issues,
        recommendations,
      },
      { budget: { maxTokens: 40, maxSectionTokens: 0 } },
    );
    const graph = context.sections.find((s) => s.kind === 'knowledge-graph');
    const cleared = context.sections.find((s) => s.kind === 'seo-issues');
    expect(graph).toBeDefined();
    expect(cleared?.truncated).toBe(true);
    expect((cleared?.content as unknown[]).length).toBe(0);
    const recs = context.sections.find((s) => s.kind === 'recommendations');
    expect(recs?.truncated).toBe(true);
  });

  it('sorts recommendations by score descending', () => {
    const context = new ContextBuilder().build({
      storeId: 'store-1',
      recommendations: [
        { ...sources.recommendations![0]!, score: 10 },
        { ...sources.recommendations![0]!, score: 95 },
      ],
    });
    const recs = context.sections.find((s) => s.kind === 'recommendations')?.content as Array<{ score: number }>;
    expect(recs.map((r) => r.score)).toEqual([95, 10]);
  });
});

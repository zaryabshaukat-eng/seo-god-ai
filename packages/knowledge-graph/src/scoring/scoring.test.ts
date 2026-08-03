import { describe, expect, it } from 'vitest';
import { buildGraph } from '../builders/graph-builder.js';
import { Graph } from '../models/graph.js';
import { fixedClock, keyword, ORIGIN, storePages, storeRecommendations } from '../test/fixtures.js';
import { authorityContribution, keywordOpportunity, pageImportance, rankRecommendations } from './scoring.js';

function enrichedGraph() {
  return buildGraph(
    {
      storeId: 'store-1',
      crawlJobId: 'crawl-1',
      pages: storePages(),
      recommendations: storeRecommendations(),
      keywords: [keyword({ targetUrls: [`${ORIGIN}/products/1`, `${ORIGIN}/products/2`] })],
    },
    { now: fixedClock },
  );
}

describe('scoring', () => {
  it('scores page importance within bounds and reacts to link count', () => {
    const graph = enrichedGraph();
    const product1 = graph.findNode('product', `${ORIGIN}/products/1`)!;
    const store = graph.findNode('store', 'store-1')!;
    const importance = pageImportance(graph, product1.id);
    expect(importance).not.toBeNull();
    expect(importance!.importance).toBeGreaterThanOrEqual(0);
    expect(importance!.importance).toBeLessThanOrEqual(100);
    expect(importance!.inboundLinks).toBeGreaterThanOrEqual(1);
    expect(importance!.authority).toBeGreaterThan(0);
    expect(pageImportance(graph, store.id)).toBeNull();
    expect(pageImportance(graph, 'missing')).toBeNull();
  });

  it('scores keyword opportunity from competition and volume', () => {
    const graph = enrichedGraph();
    const widget = graph.findNode('keyword', 'acme widget')!;
    const opportunity = keywordOpportunity(graph, widget.id);
    expect(opportunity).not.toBeNull();
    expect(opportunity!.competition).toBe(2);
    expect(opportunity!.opportunity).toBeGreaterThanOrEqual(0);
    expect(opportunity!.opportunity).toBeLessThanOrEqual(100);
    expect(keywordOpportunity(graph, graph.findNode('product', `${ORIGIN}/products/1`)!.id)).toBeNull();
    expect(keywordOpportunity(graph, 'missing')).toBeNull();
  });

  it('re-ranks recommendations using graph signals', () => {
    const graph = enrichedGraph();
    const ranked = rankRecommendations(graph);
    expect(ranked).toHaveLength(2);
    const ids = ranked.map((r) => r.recommendationId);
    expect(ids).toContain('recommendation-1');
    expect(ids).toContain('recommendation-2');
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1]!.finalScore).toBeGreaterThanOrEqual(ranked[i]!.finalScore);
    }
    for (const r of ranked) {
      expect(r.finalScore).toBeGreaterThanOrEqual(0);
      expect(r.finalScore).toBeLessThanOrEqual(100);
    }
    const rec1 = ranked.find((r) => r.recommendationId === 'recommendation-1')!;
    expect(rec1.baseScore).toBe(95);
    expect(rec1.affectedPages).toBe(1);
  });

  it('computes authority contribution along link edges', () => {
    const graph = enrichedGraph();
    const product1 = graph.findNode('product', `${ORIGIN}/products/1`)!;
    const home = graph.findNode('page', `${ORIGIN}/`)!;
    const about = graph.findNode('page', `${ORIGIN}/about`)!;
    const contribution = authorityContribution(graph, product1.id, home.id);
    expect(contribution).toBeGreaterThan(0);
    expect(authorityContribution(graph, product1.id, about.id)).toBe(0);
    expect(authorityContribution(graph, about.id, home.id)).toBe(0);
  });

  it('gives a lone content page full authority percentile', () => {
    const graph = new Graph({ now: fixedClock });
    const lone = graph.addNode({ type: 'page', externalId: 'lone', source: 'crawler' });
    const importance = pageImportance(graph, lone.id);
    expect(importance).not.toBeNull();
    expect(importance!.authorityPercentile).toBe(100);
    expect(importance!.url).toBe('lone');
  });

  it('falls back to defaults for keywords and recommendations without metadata', () => {
    const graph = new Graph({ now: fixedClock });
    const page1 = graph.addNode({ type: 'page', externalId: 'p1', source: 'crawler' });
    const bareKeyword = graph.addNode({
      type: 'keyword',
      externalId: 'bare-keyword',
      properties: {},
      source: 'builder',
    });
    graph.addEdge({ type: 'targets', from: page1.id, to: bareKeyword.id, source: 'builder' });

    const rec = graph.addNode({
      type: 'seo-recommendation',
      externalId: 'bare-rec',
      name: null,
      source: 'seo-engine',
      properties: {},
    });
    graph.addEdge({ type: 'affects', from: rec.id, to: page1.id, source: 'seo-engine' });

    const opportunity = keywordOpportunity(graph, bareKeyword.id);
    expect(opportunity).not.toBeNull();
    expect(opportunity!.keyword).toBe('bare-keyword');
    expect(opportunity!.searchVolume).toBeNull();
    expect(opportunity!.competition).toBe(1);

    const volumeKeyword = graph.addNode({
      type: 'keyword',
      externalId: 'volume-keyword',
      properties: { searchVolume: 5000, keyword: 'volume keyword' },
      source: 'builder',
    });
    graph.addEdge({ type: 'targets', from: page1.id, to: volumeKeyword.id, source: 'builder' });
    const volumeOpportunity = keywordOpportunity(graph, volumeKeyword.id);
    expect(volumeOpportunity!.searchVolume).toBe(5000);
    expect(volumeOpportunity!.keyword).toBe('volume keyword');
    expect(volumeOpportunity!.opportunity).toBeGreaterThan(0);

    const ranked = rankRecommendations(graph);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.rule).toBe('bare-rec');
    expect(ranked[0]!.title).toBe('bare-rec');
    expect(ranked[0]!.baseScore).toBe(0);
  });

  it('sorts recommendations by final score with a deterministic tiebreak', () => {
    const graph = new Graph({ now: fixedClock });
    const a = graph.addNode({
      type: 'seo-recommendation',
      externalId: 'rec-a',
      source: 'seo-engine',
      properties: { score: 50 },
    });
    const b = graph.addNode({
      type: 'seo-recommendation',
      externalId: 'rec-b',
      source: 'seo-engine',
      properties: { score: 50 },
    });
    const p1 = graph.addNode({ type: 'page', externalId: 'p1', source: 'crawler' });
    const p2 = graph.addNode({ type: 'page', externalId: 'p2', source: 'crawler' });
    graph.addEdge({ type: 'affects', from: a.id, to: p1.id, source: 'seo-engine' });
    graph.addEdge({ type: 'affects', from: b.id, to: p2.id, source: 'seo-engine' });
    const ranked = rankRecommendations(graph);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.recommendationId.localeCompare(ranked[1]!.recommendationId)).toBeLessThanOrEqual(0);
  });
});

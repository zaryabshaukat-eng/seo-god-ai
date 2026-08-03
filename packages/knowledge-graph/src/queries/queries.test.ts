import { describe, expect, it } from 'vitest';
import { buildGraph } from '../builders/graph-builder.js';
import { Graph } from '../models/graph.js';
import { fixedClock, keyword, ORIGIN, storePages, storeRecommendations } from '../test/fixtures.js';
import {
  findBrokenContentChains,
  findContentGaps,
  findEntityRelationships,
  findInternalLinkOpportunities,
  findKeywordCompetition,
  findOrphanPages,
  findRecommendationsForKeyword,
  findRecommendationsForPage,
  findRelatedPages,
  findTopicClusters,
} from './queries.js';

function enrichedGraph() {
  return buildGraph(
    {
      storeId: 'store-1',
      crawlJobId: 'crawl-1',
      pages: storePages(),
      recommendations: storeRecommendations(),
      keywords: [
        keyword({ text: 'acme widget', targetUrls: [`${ORIGIN}/products/1`, `${ORIGIN}/products/2`] }),
        keyword({ text: 'blue widget', searchIntent: undefined }),
      ],
      entities: [
        { name: 'acme', pageUrls: [`${ORIGIN}/products/1`, `${ORIGIN}/products/2`] },
        { name: 'tools', pageUrls: [`${ORIGIN}/products/1`] },
      ],
    },
    { now: fixedClock },
  );
}

describe('knowledge graph queries', () => {
  it('finds related pages via shared entities, mutual links, and collections', () => {
    const graph = enrichedGraph();
    const product1 = graph.findNode('product', `${ORIGIN}/products/1`)!;
    const product2 = graph.findNode('product', `${ORIGIN}/products/2`)!;
    const home = graph.findNode('page', `${ORIGIN}/`)!;
    const related = findRelatedPages(graph, product1.id);
    const byId = Object.fromEntries(related.map((r) => [r.pageId, r]));
    expect(byId[product2.id]).toBeDefined();
    expect(byId[product2.id]!.strength).toBeGreaterThanOrEqual(2);
    expect(byId[product2.id]!.reasons).toContain('shared-collection');
    expect(byId[home.id]!.reasons).toContain('mutual-link');
  });

  it('finds keyword competition between content nodes', () => {
    const graph = enrichedGraph();
    const widget = graph.findNode('keyword', 'acme widget')!;
    const competition = findKeywordCompetition(graph, widget.id);
    expect(competition).not.toBeNull();
    expect(competition?.competitors).toHaveLength(2);
    expect(findKeywordCompetition(graph, 'missing')).toBeNull();
  });

  it('finds internal link opportunities for orphan pages', () => {
    const graph = enrichedGraph();
    const opportunities = findInternalLinkOpportunities(graph);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]!.targetUrl).toBe(`${ORIGIN}/about`);
    expect(opportunities[0]!.suggestions.length).toBe(3);
    expect(opportunities[0]!.suggestions.every((s) => graph.hasNode(s.pageId))).toBe(true);
  });

  it('re-exports orphan and cluster detection from the query surface', () => {
    const graph = enrichedGraph();
    expect(findOrphanPages(graph).map((o) => o.url)).toEqual([`${ORIGIN}/about`]);
    expect(findTopicClusters(graph)).toHaveLength(1);
  });

  it('finds recommendations for a page', () => {
    const graph = enrichedGraph();
    const about = graph.findNode('page', `${ORIGIN}/about`)!;
    const product1 = graph.findNode('product', `${ORIGIN}/products/1`)!;
    const forAbout = findRecommendationsForPage(graph, about.id);
    expect(forAbout.map((r) => r.rule)).toEqual(['missing-title']);
    expect(forAbout[0]!.fixes).toHaveLength(1);

    const forProduct = findRecommendationsForPage(graph, product1.id);
    expect(forProduct.map((r) => r.rule)).toEqual(['slow-pages']);
  });

  it('finds recommendations affecting pages that target a keyword', () => {
    const graph = enrichedGraph();
    const widget = graph.findNode('keyword', 'acme widget')!;
    const results = findRecommendationsForKeyword(graph, widget.id);
    expect(results).toHaveLength(1);
    expect(results[0]!.rule).toBe('slow-pages');
    expect(results[0]!.affectedPages).toHaveLength(2);
  });

  it('finds co-occurring entities', () => {
    const graph = enrichedGraph();
    const acme = graph.findNode('entity', 'entity:acme')!;
    const tools = graph.findNode('entity', 'entity:tools')!;
    const relationships = findEntityRelationships(graph, acme.id);
    expect(relationships).toHaveLength(1);
    expect(relationships[0]!.entityId).toBe(tools.id);
    expect(relationships[0]!.sharedPages).toEqual([graph.findNode('product', `${ORIGIN}/products/1`)!.id]);
    expect(relationships[0]!.strength).toBe(1);
    expect(findEntityRelationships(graph, 'missing')).toEqual([]);
  });

  it('finds broken content chains', () => {
    const graph = enrichedGraph();
    const chains = findBrokenContentChains(graph);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.url).toBe(`${ORIGIN}/about`);
    expect(['no-inbound-links', 'unreachable-from-root']).toContain(chains[0]!.reason);
  });

  it('finds content gaps from untargeted keywords', () => {
    const graph = enrichedGraph();
    const gaps = findContentGaps(graph);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.keyword).toBe('blue widget');
    expect(gaps[0]!.type).toBe('untargeted-keyword');
  });

  it('returns empty results for missing nodes', () => {
    const graph = enrichedGraph();
    expect(findRelatedPages(graph, 'missing')).toEqual([]);
    expect(findEntityRelationships(graph, 'missing')).toEqual([]);
    expect(findRecommendationsForPage(graph, 'missing')).toEqual([]);
    expect(findRecommendationsForKeyword(graph, 'missing')).toEqual([]);
  });

  it('falls back to externalId for nodes without url or name', () => {
    const graph = new Graph({ now: fixedClock });
    const home = graph.addNode({ type: 'page', externalId: 'no-url-page', source: 'crawler' });
    const orphan = graph.addNode({ type: 'page', externalId: 'orphan-no-url', source: 'crawler' });
    graph.addEdge({ type: 'links_to', from: home.id, to: orphan.id, source: 'crawler' });

    const keywordNode = graph.addNode({
      type: 'keyword',
      externalId: 'no-meta-keyword',
      properties: { keyword: 42 },
      source: 'builder',
    });
    graph.addEdge({ type: 'targets', from: home.id, to: keywordNode.id, source: 'builder' });
    graph.addEdge({ type: 'targets', from: orphan.id, to: keywordNode.id, source: 'builder' });

    const recommendation = graph.addNode({
      type: 'seo-recommendation',
      externalId: 'rec-no-meta',
      source: 'seo-engine',
      properties: {},
    });
    graph.addEdge({ type: 'affects', from: recommendation.id, to: home.id, source: 'seo-engine' });

    const opportunities = findInternalLinkOpportunities(graph);
    expect(opportunities[0]!.targetUrl).toBe('no-url-page');
    expect(opportunities[0]!.suggestions[0]!.url).toBe('orphan-no-url');

    const competition = findKeywordCompetition(graph, keywordNode.id);
    expect(competition?.keyword).toBe('no-meta-keyword');

    const pageRecs = findRecommendationsForPage(graph, home.id);
    expect(pageRecs[0]!.rule).toBe('rec-no-meta');
    expect(pageRecs[0]!.priority).toBe('LOW');

    const keywordRecs = findRecommendationsForKeyword(graph, keywordNode.id);
    expect(keywordRecs[0]!.rule).toBe('rec-no-meta');
    expect(keywordRecs[0]!.priority).toBe('LOW');
    expect(findContentGaps(graph)).toEqual([]);
  });

  it('roots broken chains at the website when no homepage exists', () => {
    const graph = new Graph({ now: fixedClock });
    graph.addNode({ type: 'website', externalId: ORIGIN, source: 'builder' });
    const lone = graph.addNode({ type: 'page', externalId: `${ORIGIN}/lone`, properties: { url: `${ORIGIN}/lone` }, source: 'crawler' });
    const chains = findBrokenContentChains(graph);
    expect(chains.some((c) => c.pageId === lone.id && c.reason === 'unreachable-from-root')).toBe(true);
  });

  it('does not double-report pages already in chains', () => {
    const graph = enrichedGraph();
    const chains = findBrokenContentChains(graph);
    expect(chains).toHaveLength(1);
    expect(['no-inbound-links', 'unreachable-from-root']).toContain(chains[0]!.reason);
  });

  it('marks every page unreachable when no website or home exists', () => {
    const graph = new Graph({ now: fixedClock });
    const a = graph.addNode({ type: 'page', externalId: 'a', source: 'crawler' });
    const b = graph.addNode({ type: 'page', externalId: 'b', source: 'crawler' });
    graph.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });
    const chains = findBrokenContentChains(graph);
    expect(chains).toHaveLength(2);
    expect(chains.map((c) => c.pageId).sort()).toEqual([a.id, b.id]);
    expect(chains.every((c) => c.reason === 'unreachable-from-root')).toBe(true);
  });

  it('falls back to externalId for gap keywords without a string keyword', () => {
    const graph = new Graph({ now: fixedClock });
    graph.addNode({
      type: 'keyword',
      externalId: 'gap-keyword',
      properties: { keyword: 42 },
      source: 'builder',
    });
    const gaps = findContentGaps(graph);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.keyword).toBe('gap-keyword');
  });
});

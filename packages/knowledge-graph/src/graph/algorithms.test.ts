import { describe, expect, it } from 'vitest';
import {
  connectedComponents,
  discoverTopicClusters,
  estimateAuthorityFlow,
  findDuplicateTargets,
  findOrphanPages,
  identifyHubs,
  internalLinkDepth,
  nodesByType,
  recommendationDependencyGraph,
} from './algorithms.js';
import { Graph } from '../models/graph.js';
import { buildGraph } from '../builders/graph-builder.js';
import { fixedClock, keyword, ORIGIN, storePages, storeRecommendations } from '../test/fixtures.js';

function storeGraph() {
  return buildGraph(
    {
      storeId: 'store-1',
      crawlJobId: 'crawl-1',
      pages: storePages(),
      recommendations: storeRecommendations(),
    },
    { now: fixedClock },
  );
}

describe('graph algorithms', () => {
  it('finds connected components', () => {
    const graph = new Graph();
    const a = graph.addNode({ type: 'page', externalId: 'a', source: 'crawler' });
    const b = graph.addNode({ type: 'page', externalId: 'b', source: 'crawler' });
    const c = graph.addNode({ type: 'keyword', externalId: 'c', source: 'builder' });
    graph.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });
    expect(connectedComponents(graph)).toEqual([[a.id, b.id], [c.id]]);
  });

  it('detects orphan pages (no inbound internal links)', () => {
    const graph = storeGraph();
    const orphans = findOrphanPages(graph);
    expect(orphans.map((o) => o.url)).toEqual([`${ORIGIN}/about`]);
    expect(orphans[0]!.inLinks).toBe(0);
    expect(orphans[0]!.type).toBe('page');
  });

  it('computes internal link depth from the root', () => {
    const graph = storeGraph();
    const home = graph.findNode('page', `${ORIGIN}/`)!;
    const depth = internalLinkDepth(graph, home.id);
    expect(depth.get(home.id)).toBe(0);
    expect(depth.get(graph.findNode('collection', `${ORIGIN}/collections/all`)!.id)).toBe(1);
    expect(depth.get(graph.findNode('product', `${ORIGIN}/products/1`)!.id)).toBe(1);
    expect(depth.has(graph.findNode('page', `${ORIGIN}/about`)!.id)).toBe(false);
  });

  it('identifies hubs by outbound internal links', () => {
    const graph = storeGraph();
    const hubs = identifyHubs(graph, 3);
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.url).toBe(`${ORIGIN}/`);
    expect(hubs[0]!.outLinks).toBeGreaterThanOrEqual(3);
  });

  it('estimates normalized authority flow deterministically', () => {
    const graph = storeGraph();
    const first = estimateAuthorityFlow(graph);
    const second = estimateAuthorityFlow(graph);
    const values = [...first.values()];
    expect(values.every((v) => Number.isFinite(v))).toBe(true);
    expect(values.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 10);
    expect(first).toEqual(second);
  });

  it('discovers topic clusters from shared entities', () => {
    const graph = buildGraph(
      {
        storeId: 'store-1',
        crawlJobId: 'crawl-1',
        pages: storePages(),
        recommendations: [],
        entities: [{ name: 'acme', pageUrls: [`${ORIGIN}/products/1`, `${ORIGIN}/products/2`] }],
      },
      { now: fixedClock },
    );
    const clusters = discoverTopicClusters(graph);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.pageIds).toHaveLength(3);
    expect(clusters[0]!.entities).toContain('acme');
    expect(clusters[0]!.name).toBe('acme');
  });

  it('finds duplicate keyword targets', () => {
    const graph = buildGraph(
      {
        storeId: 'store-1',
        crawlJobId: 'crawl-1',
        pages: storePages(),
        recommendations: [],
        keywords: [keyword({ targetUrls: [`${ORIGIN}/products/1`, `${ORIGIN}/products/2`] })],
      },
      { now: fixedClock },
    );
    const duplicates = findDuplicateTargets(graph);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]!.keyword).toBe('acme widget');
    expect(duplicates[0]!.sources).toHaveLength(2);

    const plain = storeGraph();
    expect(findDuplicateTargets(plain)).toHaveLength(0);
  });

  it('builds the recommendation dependency graph', () => {
    const graph = storeGraph();
    const dependencies = recommendationDependencyGraph(graph);
    expect(dependencies).toHaveLength(2);
    const first = dependencies.find((d) => d.recommendationId === 'recommendation-1');
    expect(first?.fixes).toEqual([graph.findNode('seo-issue', 'missing-title@https://acme.example/about')!.id]);
    expect(first?.affects).toEqual([graph.findNode('page', `${ORIGIN}/about`)!.id]);
    expect(first?.derivedFrom).toBe(graph.findNode('crawl', 'crawl-1')!.id);
    expect(first?.coOccurring).toEqual([]);
  });

  it('groups nodes by type deterministically', () => {
    const graph = storeGraph();
    const grouped = nodesByType(graph);
    expect(grouped.product).toHaveLength(2);
    expect(grouped['seo-recommendation']).toHaveLength(2);
    expect([...grouped.product].every((id, i, arr) => i === 0 || arr[i - 1]! <= id)).toBe(true);
  });

  it('returns empty results for empty graphs', () => {
    const graph = new Graph();
    expect(findOrphanPages(graph)).toEqual([]);
    expect(estimateAuthorityFlow(graph)).toEqual(new Map());
    expect(discoverTopicClusters(graph)).toEqual([]);
    expect(recommendationDependencyGraph(graph)).toEqual([]);
  });

  it('compresses union-find paths in connected components', () => {
    const graph = new Graph();
    const a = graph.addNode({ type: 'page', externalId: 'a', source: 'crawler' });
    const b = graph.addNode({ type: 'page', externalId: 'b', source: 'crawler' });
    const c = graph.addNode({ type: 'page', externalId: 'c', source: 'crawler' });
    graph.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });
    graph.addEdge({ type: 'links_to', from: c.id, to: b.id, source: 'crawler' });
    const components = connectedComponents(graph);
    expect(components).toEqual([[a.id, b.id, c.id]]);
  });

  it('reports unreachable and missing-root depths', () => {
    const graph = storeGraph();
    expect(internalLinkDepth(graph, 'missing-root').size).toBe(0);
    const home = graph.findNode('page', `${ORIGIN}/`)!;
    const depth = internalLinkDepth(graph, home.id);
    expect(depth.get(graph.findNode('page', `${ORIGIN}/about`)!.id)).toBeUndefined();
  });

  it('falls back to externalId for nodes without a url property', () => {
    const graph = new Graph();
    const bare = graph.addNode({ type: 'page', externalId: 'bare-page', properties: {}, source: 'crawler' });
    const linked = graph.addNode({ type: 'product', externalId: 'linked-product', source: 'crawler' });
    graph.addEdge({ type: 'links_to', from: bare.id, to: linked.id, source: 'crawler' });
    const orphans = findOrphanPages(graph);
    expect(orphans.some((o) => o.id === bare.id && o.url === 'bare-page')).toBe(true);
    const hubs = identifyHubs(graph, 1);
    expect(hubs.some((h) => h.id === bare.id && h.url === 'bare-page')).toBe(true);
  });

  it('handles dangling content nodes in authority flow', () => {
    const graph = new Graph();
    const a = graph.addNode({ type: 'page', externalId: 'a', source: 'crawler' });
    const b = graph.addNode({ type: 'page', externalId: 'b', source: 'crawler' });
    const dangling = graph.addNode({ type: 'page', externalId: 'dangling', source: 'crawler' });
    graph.addEdge({ type: 'links_to', from: a.id, to: b.id, weight: 1, source: 'crawler' });
    const flow = estimateAuthorityFlow(graph);
    expect(flow.size).toBe(3);
    expect(flow.get(dangling.id) ?? 0).toBeGreaterThan(0);
    expect([...flow.values()].reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 10);
  });

  it('unions pages by mutual links and leaves single pages out of clusters', () => {
    const graph = new Graph();
    const a = graph.addNode({ type: 'page', externalId: 'a', source: 'crawler' });
    const b = graph.addNode({ type: 'page', externalId: 'b', source: 'crawler' });
    const c = graph.addNode({ type: 'page', externalId: 'c', source: 'crawler' });
    graph.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });
    graph.addEdge({ type: 'links_to', from: b.id, to: a.id, source: 'crawler' });
    const clusters = discoverTopicClusters(graph);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.pageIds).toContain(a.id);
    expect(clusters[0]!.pageIds).toContain(b.id);
    expect(clusters[0]!.name).toBe('Untitled cluster');
    expect(clusters[0]!.pageIds).not.toContain(c.id);
  });

  it('skips non-keyword targets and non-page sources in duplicates', () => {
    const graph = new Graph();
    const page1 = graph.addNode({ type: 'page', externalId: 'p1', source: 'crawler' });
    const word = graph.addNode({ type: 'keyword', externalId: 'k1', name: 'keyword one', source: 'builder' });
    graph.addEdge({ type: 'targets', from: page1.id, to: word.id, source: 'builder' });
    const duplicates = findDuplicateTargets(graph);
    expect(duplicates).toHaveLength(0);
  });

  it('surfaces recommendations without fixes and with co-occurrence', () => {
    const graph = new Graph();
    const crawl = graph.addNode({ type: 'crawl', externalId: 'crawl-1', source: 'builder' });
    const recA = graph.addNode({
      type: 'seo-recommendation',
      externalId: 'rec-a',
      name: null,
      source: 'seo-engine',
      properties: {},
    });
    const recB = graph.addNode({
      type: 'seo-recommendation',
      externalId: 'rec-b',
      source: 'seo-engine',
      properties: {},
    });
    graph.addNode({
      type: 'seo-recommendation',
      externalId: 'rec-c',
      source: 'seo-engine',
      properties: {},
    });
    const issue = graph.addNode({ type: 'seo-issue', externalId: 'issue-1', source: 'seo-engine' });
    graph.addEdge({ type: 'derived_from', from: recA.id, to: crawl.id, source: 'seo-engine' });
    graph.addEdge({ type: 'fixes', from: recA.id, to: issue.id, source: 'seo-engine' });
    graph.addEdge({ type: 'fixes', from: recB.id, to: issue.id, source: 'seo-engine' });
    graph.addEdge({ type: 'occurs_in', from: issue.id, to: crawl.id, source: 'seo-engine' });
    const dependencies = recommendationDependencyGraph(graph);
    const a = dependencies.find((d) => d.recommendationId === 'rec-a');
    expect(a).toBeDefined();
    expect(a!.title).toBe('rec-a');
    expect(a!.derivedFrom).toBe(crawl.id);
    expect(a!.coOccurring).toEqual([recB.id]);
    const b = dependencies.find((d) => d.recommendationId === 'rec-b');
    expect(b!.fixes).toEqual([issue.id]);
    const c = dependencies.find((d) => d.recommendationId === 'rec-c')!;
    expect(c.fixes).toEqual([]);
    expect(c.derivedFrom).toBeNull();
  });

  it('uses entity externalId for unnamed entities and keyword id for missing keyword names', () => {
    const graph = new Graph({ now: fixedClock });
    const p1 = graph.addNode({ type: 'page', externalId: 'p1', source: 'crawler' });
    const p2 = graph.addNode({ type: 'page', externalId: 'p2', source: 'crawler' });
    const entity = graph.addNode({ type: 'entity', externalId: 'entity:ghost', properties: {}, source: 'builder' });
    graph.addEdge({ type: 'contains', from: p1.id, to: entity.id, source: 'crawler' });
    graph.addEdge({ type: 'contains', from: p2.id, to: entity.id, source: 'crawler' });
    const clusters = discoverTopicClusters(graph);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.name).toBe('entity:ghost');

    const bareKeyword = graph.addNode({ type: 'keyword', externalId: 'k1', properties: {}, source: 'builder' });
    graph.addEdge({ type: 'targets', from: p1.id, to: bareKeyword.id, source: 'builder' });
    graph.addEdge({ type: 'targets', from: p2.id, to: bareKeyword.id, source: 'builder' });
    const duplicates = findDuplicateTargets(graph);
    const dup = duplicates.find((d) => d.keywordId === bareKeyword.id);
    expect(dup?.keyword).toBe(bareKeyword.id);
  });

  it('breaks entity ties by name in cluster naming', () => {
    const graph = new Graph({ now: fixedClock });
    const p1 = graph.addNode({ type: 'page', externalId: 'p1', source: 'crawler' });
    const p2 = graph.addNode({ type: 'page', externalId: 'p2', source: 'crawler' });
    const acme = graph.addNode({ type: 'entity', externalId: 'e:acme', source: 'builder' });
    const widgets = graph.addNode({ type: 'entity', externalId: 'e:widgets', source: 'builder' });
    graph.addEdge({ type: 'contains', from: p1.id, to: acme.id, source: 'crawler' });
    graph.addEdge({ type: 'contains', from: p1.id, to: widgets.id, source: 'crawler' });
    graph.addEdge({ type: 'contains', from: p2.id, to: acme.id, source: 'crawler' });
    graph.addEdge({ type: 'contains', from: p2.id, to: widgets.id, source: 'crawler' });
    const clusters = discoverTopicClusters(graph);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.entities.sort()).toEqual(['e:acme', 'e:widgets']);
  });
});

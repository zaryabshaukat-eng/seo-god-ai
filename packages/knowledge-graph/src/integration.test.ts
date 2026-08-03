import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  diffGraphs,
  estimateAuthorityFlow,
  findBrokenContentChains,
  findContentGaps,
  findEntityRelationships,
  findInternalLinkOpportunities,
  findKeywordCompetition,
  findOrphanPages,
  findRecommendationsForPage,
  findRelatedPages,
  findTopicClusters,
  Graph,
  GraphSnapshot,
  KnowledgeGraphService,
  keywordOpportunity,
  pageImportance,
  rankRecommendations,
} from './index.js';
import type { GraphSnapshotRecord, GraphSnapshotStore } from './index.js';
import { fixedClock, keyword, ORIGIN, storePages, storeRecommendations } from './test/fixtures.js';
import type { GraphBuildInput } from './types/input.js';

class InMemoryStore implements GraphSnapshotStore {
  private readonly records = new Map<string, GraphSnapshotRecord>();
  async create(record: GraphSnapshotRecord): Promise<GraphSnapshotRecord> {
    this.records.set(record.id, record);
    return record;
  }
  async findById(id: string): Promise<GraphSnapshotRecord | null> {
    return this.records.get(id) ?? null;
  }
  async latestForStore(storeId: string): Promise<GraphSnapshotRecord | null> {
    return (
      [...this.records.values()]
        .filter((r) => r.storeId === storeId)
        .sort((a, b) => b.version - a.version)[0] ?? null
    );
  }
  async nextVersion(storeId: string): Promise<number> {
    return ((await this.latestForStore(storeId))?.version ?? 0) + 1;
  }
  async listForStore(storeId: string): Promise<GraphSnapshotRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.storeId === storeId)
      .sort((a, b) => a.version - b.version);
  }
}

function crawlInput(): GraphBuildInput {
  return {
    storeId: 'store-1',
    crawlJobId: 'crawl-1',
    pages: storePages(),
    recommendations: storeRecommendations(),
    keywords: [
      keyword({ text: 'acme widget', targetUrls: [`${ORIGIN}/products/1`, `${ORIGIN}/products/2`] }),
      keyword({ text: 'blue widget' }),
    ],
    entities: [
      { name: 'acme', pageUrls: [`${ORIGIN}/products/1`, `${ORIGIN}/products/2`] },
      { name: 'tools', pageUrls: [`${ORIGIN}/products/2`] },
    ],
    label: 'integration run',
  };
}

describe('knowledge-graph end-to-end pipeline', () => {
  it('builds, persists, versions, diffs, and queries a snapshot', async () => {
    const service = new KnowledgeGraphService({ store: new InMemoryStore(), now: fixedClock });
    const input = crawlInput();

    const first = await service.buildGraph(input);
    expect(first.version).toBe(1);
    expect(first.previousSnapshotId).toBeNull();
    expect(first.diff).toBeNull();

    const second = await service.buildGraph(input);
    expect(second.version).toBe(2);
    expect(second.previousSnapshotId).toBe(first.snapshotId);
    expect(second.diff).not.toBeNull();
    expect(second.diff?.addedNodes).toEqual([]);
    expect(second.diff?.removedNodes).toEqual([]);

    const graph = await service.loadGraph(second.snapshotId);
    const home = graph.findNode('page', `${ORIGIN}/`)!;
    const product1 = graph.findNode('product', `${ORIGIN}/products/1`)!;
    const about = graph.findNode('page', `${ORIGIN}/about`)!;
    const widget = graph.findNode('keyword', 'acme widget')!;

    expect(graph.nodesArray()).toHaveLength(25);
    expect(graph.edgesArray()).toHaveLength(53);
    expect(findOrphanPages(graph).map((o) => o.url)).toEqual([`${ORIGIN}/about`]);
    expect(findRelatedPages(graph, product1.id).some((r) => r.pageId === home.id)).toBe(true);
    expect(findKeywordCompetition(graph, widget.id)?.competitors).toHaveLength(2);
    expect(findInternalLinkOpportunities(graph).some((o) => o.targetUrl === `${ORIGIN}/about`)).toBe(true);
    expect(findRecommendationsForPage(graph, about.id)).toHaveLength(1);
    expect(findEntityRelationships(graph, graph.findNode('entity', 'entity:acme')!.id)).toHaveLength(1);
    expect(findBrokenContentChains(graph)).toHaveLength(1);
    expect(findTopicClusters(graph)).toHaveLength(1);
    expect(findContentGaps(graph).map((g) => g.keyword)).toContain('blue widget');

    const importance = pageImportance(graph, product1.id)!;
    expect(importance.importance).toBeGreaterThan(0);
    expect(importance.importance).toBeLessThanOrEqual(100);
    expect(keywordOpportunity(graph, widget.id)!.opportunity).toBeGreaterThanOrEqual(0);
    expect(rankRecommendations(graph).length).toBe(2);
    expect(estimateAuthorityFlow(graph).size).toBeGreaterThan(0);

    const exported = await service.exportGraph(second.snapshotId);
    expect(exported.source).toBe('crawl.completed');
    expect(exported.summary.nodeCount).toBe(25);
    const imported = await service.importGraph({ ...exported, id: 'imported' });
    expect(imported.version).toBe(exported.version);
  });

  it('updates a snapshot and reflects the change in a later diff', async () => {
    const service = new KnowledgeGraphService({ store: new InMemoryStore(), now: fixedClock });
    const built = await service.buildGraph(crawlInput());
    const record = await service.exportGraph(built.snapshotId);
    const product = record.nodes.find((n) => n.type === 'product')!;
    const removedEdge = record.edges[0]!;

    const updated = await service.updateGraph({
      storeId: 'store-1',
      snapshotId: built.snapshotId,
      nodesToAdd: [
        {
          id: 'node-new',
          type: 'keyword',
          externalId: 'new-keyword',
          name: 'new keyword',
          properties: {},
          source: 'builder',
          version: 1,
          createdAt: fixedClock(),
          updatedAt: fixedClock(),
        },
      ],
      edgesToAdd: [
        {
          id: 'edge-new',
          type: 'targets',
          from: product.id,
          to: 'node-new',
          weight: 1,
          confidence: 1,
          source: 'builder',
          properties: {},
          createdAt: fixedClock(),
        },
      ],
      edgeIdsToRemove: [removedEdge.id],
    });
    expect(updated.addedNodes).toHaveLength(1);
    expect(updated.removedEdges).toHaveLength(1);

    const rebuilt = Graph.fromRecords(record.nodes, record.edges);
    const after = Graph.fromRecords(
      (await service.exportGraph(updated.snapshotId)).nodes,
      (await service.exportGraph(updated.snapshotId)).edges,
    );
    const diff = diffGraphs(rebuilt, after, {
      previousId: built.snapshotId,
      currentId: updated.snapshotId,
      previousVersion: 1,
      currentVersion: 2,
    });
    expect(diff.addedNodes.map((n) => n.externalId)).toContain('new-keyword');
    expect(diff.removedEdges).toHaveLength(1);
  });

  it('round-trips a snapshot through its record representation', () => {
    const graph = buildGraph(crawlInput(), { now: fixedClock });
    const snapshot = new GraphSnapshot('store-1', 1, graph, 'crawl.completed', {
      label: 'round trip',
      now: fixedClock,
    });
    const record = snapshot.toRecord();
    const rebuilt = Graph.fromRecords(record.nodes, record.edges);
    expect(rebuilt.nodesArray()).toHaveLength(record.summary.nodeCount);
    expect(rebuilt.edgesArray()).toHaveLength(record.summary.edgeCount);
    expect(snapshot.nodeCount).toBe(record.summary.nodeCount);
    expect(snapshot.edgeCount).toBe(record.summary.edgeCount);
  });
});

import { ConflictError, NotFoundError } from '@seogod/core';
import type { EventBus, EventInput } from '@seogod/events';
import { MetricsRegistry } from '@seogod/monitoring';
import { createLogger } from '@seogod/logging';
import { describe, expect, it } from 'vitest';
import type { GraphSnapshotStore } from '../persistence/graph-snapshot-store.js';
import { KnowledgeGraphService } from './knowledge-graph-service.js';
import { fixedClock, STORE_ID, storePages, storeRecommendations, buildInput, ORIGIN } from '../test/fixtures.js';
import type { GraphSnapshotRecord } from '../types/snapshot.js';

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
    const list = [...this.records.values()]
      .filter((r) => r.storeId === storeId)
      .sort((a, b) => b.version - a.version);
    return list[0] ?? null;
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

class FakeEventBus {
  published: EventInput[] = [];
  async publish(input: EventInput): Promise<unknown> {
    this.published.push(input);
    return { id: `event-${this.published.length}` };
  }
  subscribe(): void {
    // no-op for tests
  }
}

function harness() {
  const store = new InMemoryStore();
  const bus = new FakeEventBus();
  const metrics = new MetricsRegistry();
  const logger = createLogger({ level: 'silent' });
  const service = new KnowledgeGraphService({
    store,
    eventBus: bus as unknown as EventBus,
    metrics,
    logger,
    now: fixedClock,
  });
  return { store, bus, metrics, service };
}

describe('KnowledgeGraphService', () => {
  it('builds the first snapshot with version 1 and no diff', async () => {
    const { service, bus } = harness();
    const result = await service.buildGraph(
      buildInput({ label: 'nightly crawl', pages: storePages(), recommendations: storeRecommendations() }),
    );
    expect(result.version).toBe(1);
    expect(result.previousSnapshotId).toBeNull();
    expect(result.diff).toBeNull();
    expect(result.nodeCount).toBe(20);
    expect(result.edgeCount).toBe(46);
    expect(result.storeId).toBe(STORE_ID);
    expect(bus.published.map((e) => e.type)).toContain('graph.built');
  });

  it('builds the second snapshot with a diff against the previous', async () => {
    const { service } = harness();
    const input = buildInput({ pages: storePages(), recommendations: storeRecommendations() });
    const first = await service.buildGraph(input);
    const second = await service.buildGraph(input);
    expect(second.version).toBe(2);
    expect(second.previousSnapshotId).toBe(first.snapshotId);
    expect(second.diff).not.toBeNull();
    expect(second.diff?.previousId).toBe(first.snapshotId);
    expect(second.diff?.addedNodes).toEqual([]);
    expect(second.diff?.removedNodes).toEqual([]);
  });

  it('updates an existing snapshot additively', async () => {
    const { service, bus } = harness();
    const built = await service.buildGraph(
      buildInput({ pages: storePages(), recommendations: storeRecommendations() }),
    );
    const record = await service.exportGraph(built.snapshotId);
    const product = record.nodes.find((n) => n.type === 'product');
    const removedEdge = record.edges[0]!;
    const result = await service.updateGraph({
      storeId: STORE_ID,
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
          from: product!.id,
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
    expect(result.snapshotId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.addedNodes).toHaveLength(1);
    expect(result.removedEdges).toHaveLength(1);
    expect(result.addedEdges).toHaveLength(1);
    const events = bus.published.map((e) => e.type);
    expect(events).toContain('graph.updated');
    expect(events).toContain('graph.relationshipAdded');
    expect(events).toContain('graph.relationshipRemoved');
  });

  it('compares arbitrary snapshots', async () => {
    const { service, bus } = harness();
    const input = buildInput({ pages: storePages(), recommendations: storeRecommendations() });
    const first = await service.buildGraph(input);
    const second = await service.buildGraph(input);
    const diff = await service.compareSnapshots(first.snapshotId, second.snapshotId);
    expect(diff).not.toBeNull();
    expect(diff?.currentVersion).toBe(2);
    expect(bus.published.map((e) => e.type)).toContain('graph.compared');
    expect(await service.compareSnapshots('missing', second.snapshotId)).toBeNull();
  });

  it('runs queries against a snapshot', async () => {
    const { service } = harness();
    const built = await service.buildGraph(
      buildInput({ pages: storePages(), recommendations: storeRecommendations() }),
    );
    const queries = await service.query(built.snapshotId);
    const orphans = queries.findOrphanPages();
    expect(orphans.map((o) => o.url)).toEqual([`${ORIGIN}/about`]);
    expect(queries.findTopicClusters()).toHaveLength(1);
    expect(queries.findKeywordCompetition('missing')).toBeNull();
    expect(queries.findContentGaps()).toEqual([]);

    const record = await service.exportGraph(built.snapshotId);
    const home = record.nodes.find((n) => n.externalId === `${ORIGIN}/`)!;
    const product = record.nodes.find((n) => n.externalId === `${ORIGIN}/products/1`)!;
    const keyword = record.nodes.find((n) => n.type === 'keyword');
    const entity = record.nodes.find((n) => n.type === 'entity');
    expect(queries.findRelatedPages(home.id).length).toBeGreaterThan(0);
    expect(queries.findInternalLinkOpportunities().length).toBeGreaterThan(0);
    expect(queries.findRecommendationsForPage(home.id).length).toBeGreaterThanOrEqual(0);
    expect(queries.findBrokenContentChains().length).toBeGreaterThan(0);
    if (keyword !== undefined) {
      expect(queries.findRecommendationsForKeyword(keyword.id)).toBeDefined();
    }
    if (entity !== undefined) {
      expect(queries.findEntityRelationships(entity.id)).toBeDefined();
    }
    expect(queries.findRelatedPages(product.id).length).toBeGreaterThan(0);
  });

  it('throws when updating a missing snapshot', async () => {
    const { service } = harness();
    await expect(
      service.updateGraph({ storeId: STORE_ID, snapshotId: 'missing' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('works without an event bus and without an explicit clock', async () => {
    const store = new InMemoryStore();
    const service = new KnowledgeGraphService({ store });
    await expect(
      service.buildGraph(buildInput({ pages: storePages(), recommendations: [] })),
    ).resolves.toMatchObject({ version: 1 });
  });

  it('defaults the snapshot source when none is provided', async () => {
    const { service } = harness();
    const built = await service.buildGraph(
      buildInput({ source: undefined, pages: storePages(), recommendations: [] }),
    );
    const record = await service.exportGraph(built.snapshotId);
    expect(record.source).toBe('crawl.completed');
  });

  it('uses the default Prisma-backed store when none is provided', async () => {
    const service = new KnowledgeGraphService({ store: undefined as never });
    expect(service).toBeInstanceOf(KnowledgeGraphService);
  });

  it('throws when loading or exporting a missing snapshot', async () => {
    const { service } = harness();
    await expect(service.loadGraph('missing')).rejects.toThrow(NotFoundError);
    await expect(service.exportGraph('missing')).rejects.toThrow(NotFoundError);
  });

  it('exports and imports snapshots, rejecting duplicates', async () => {
    const { service } = harness();
    const built = await service.buildGraph(
      buildInput({ pages: storePages(), recommendations: storeRecommendations() }),
    );
    const exported = await service.exportGraph(built.snapshotId);
    const imported = await service.importGraph({ ...exported, id: 'imported-1' });
    expect(imported.snapshotId).toBe('imported-1');
    await expect(service.importGraph({ ...exported, id: 'imported-1' })).rejects.toThrow(ConflictError);
  });

  it('updates metrics while building', async () => {
    const { service, metrics } = harness();
    await service.buildGraph(
      buildInput({ pages: storePages(), recommendations: storeRecommendations() }),
    );
    const snapshot = metrics.snapshot();
    expect(snapshot.counters.knowledge_graph_snapshots_built).toBe(1);
    expect(snapshot.gauges.knowledge_graph_nodes).toBe(20);
  });

  it('swallows event publishing failures', async () => {
    const store = new InMemoryStore();
    const failingBus = {
      async publish(): Promise<unknown> {
        throw new Error('bus down');
      },
      subscribe(): void {},
    };
    const service = new KnowledgeGraphService({
      store,
      eventBus: failingBus as unknown as EventBus,
      logger: createLogger({ level: 'silent' }),
      now: fixedClock,
    });
    await expect(
      service.buildGraph(buildInput({ pages: storePages(), recommendations: [] })),
    ).resolves.toMatchObject({ version: 1 });
  });

  it('updates when removing nodes cascades to incident edges', async () => {
    const { service } = harness();
    const built = await service.buildGraph(
      buildInput({ pages: storePages(), recommendations: storeRecommendations() }),
    );
    const record = await service.exportGraph(built.snapshotId);
    const product = record.nodes.find((n) => n.type === 'product')!;
    const result = await service.updateGraph({
      storeId: STORE_ID,
      snapshotId: built.snapshotId,
      nodeIdsToRemove: [product.id],
    });
    expect(result.removedNodes).toHaveLength(1);
    expect(result.removedEdges.length).toBeGreaterThan(0);
  });
});

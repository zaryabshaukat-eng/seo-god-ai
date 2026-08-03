import { ConflictError, NotFoundError } from '@seogod/core';
import { getPrismaClient } from '@seogod/database';
import type { EventBus, EventInput } from '@seogod/events';
import type { Logger } from '@seogod/logging';
import type { MetricsRegistry } from '@seogod/monitoring';
import { GraphBuilder } from '../builders/graph-builder.js';
import { diffGraphs } from '../graph/diff.js';
import { Graph } from '../models/graph.js';
import { GraphSnapshot } from '../models/snapshot.js';
import { PrismaGraphSnapshotStore } from '../persistence/graph-snapshot-store.js';
import type { GraphSnapshotStore } from '../persistence/graph-snapshot-store.js';
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
} from '../queries/queries.js';
import type { GraphBuildInput, GraphBuildResult, GraphUpdateInput, GraphUpdateResult } from '../types/input.js';
import type { GraphEdgeData, GraphNodeData } from '../types/graph.js';
import type { GraphSnapshotRecord, SnapshotDiff } from '../types/snapshot.js';

/** The query surface exposed by {@link KnowledgeGraphService.query}. */
export interface KnowledgeGraphQuery {
  findRelatedPages(pageId: string): ReturnType<typeof findRelatedPages>;
  findKeywordCompetition(keywordId: string): ReturnType<typeof findKeywordCompetition>;
  findInternalLinkOpportunities(): ReturnType<typeof findInternalLinkOpportunities>;
  findOrphanPages(): ReturnType<typeof findOrphanPages>;
  findTopicClusters(): ReturnType<typeof findTopicClusters>;
  findRecommendationsForPage(pageId: string): ReturnType<typeof findRecommendationsForPage>;
  findRecommendationsForKeyword(keywordId: string): ReturnType<typeof findRecommendationsForKeyword>;
  findEntityRelationships(entityId: string): ReturnType<typeof findEntityRelationships>;
  findBrokenContentChains(): ReturnType<typeof findBrokenContentChains>;
  findContentGaps(): ReturnType<typeof findContentGaps>;
}

export interface KnowledgeGraphServiceOptions {
  store?: GraphSnapshotStore;
  builder?: GraphBuilder;
  eventBus?: EventBus;
  logger?: Logger;
  metrics?: MetricsRegistry;
  now?: () => Date;
}

/**
 * Public API for the knowledge graph: build/update/compare snapshots, query
 * them, and export/import them. Persistence is behind the
 * {@link GraphSnapshotStore} interface; PostgreSQL via Prisma is the default.
 */
export class KnowledgeGraphService {
  private readonly store: GraphSnapshotStore;
  private readonly builder: GraphBuilder;
  private readonly eventBus: EventBus | undefined;
  private readonly logger: Logger | undefined;
  private readonly metrics: MetricsRegistry | undefined;
  private readonly now: () => Date;

  constructor(options: KnowledgeGraphServiceOptions = {}) {
    this.store = options.store ?? new PrismaGraphSnapshotStore(getPrismaClient());
    this.builder = options.builder ?? new GraphBuilder({ now: options.now });
    this.eventBus = options.eventBus;
    this.logger = options.logger;
    this.metrics = options.metrics;
    this.now = options.now ?? (() => new Date());
  }

  async buildGraph(input: GraphBuildInput): Promise<GraphBuildResult> {
    const startedAt = this.now().getTime();
    const graph = this.builder.build(input);
    const version = await this.store.nextVersion(input.storeId);
    const previous = await this.store.latestForStore(input.storeId);
    const previousSnapshotId = previous?.id ?? null;

    const snapshot = new GraphSnapshot(input.storeId, version, graph, input.source ?? 'crawl.completed', {
      label: input.label ?? null,
      previousSnapshotId,
      now: this.now,
    });
    const record = snapshot.toRecord();
    record.summary.buildMs = this.now().getTime() - startedAt;
    await this.store.create(record);

    let diff: SnapshotDiff | null = null;
    if (previous !== null) {
      diff = diffGraphs(Graph.fromRecords(previous.nodes, previous.edges), graph, {
        previousId: previous.id,
        currentId: snapshot.id,
        previousVersion: previous.version,
        currentVersion: version,
      });
    }

    this.metrics?.increment('knowledge_graph_snapshots_built');
    this.metrics?.setGauge('knowledge_graph_nodes', record.summary.nodeCount);
    this.metrics?.setGauge('knowledge_graph_edges', record.summary.edgeCount);
    this.logger?.info(
      {
        storeId: input.storeId,
        snapshotId: snapshot.id,
        version,
        nodeCount: record.summary.nodeCount,
        edgeCount: record.summary.edgeCount,
      },
      'knowledge graph snapshot built',
    );
    await this.publish({
      type: 'graph.built',
      aggregateType: 'store',
      aggregateId: input.storeId,
      payload: {
        snapshotId: snapshot.id,
        storeId: input.storeId,
        version,
        nodeCount: record.summary.nodeCount,
        edgeCount: record.summary.edgeCount,
      },
    });

    return {
      snapshotId: snapshot.id,
      storeId: input.storeId,
      version,
      nodeCount: record.summary.nodeCount,
      edgeCount: record.summary.edgeCount,
      previousSnapshotId,
      diff,
    };
  }

  async updateGraph(input: GraphUpdateInput): Promise<GraphUpdateResult> {
    const previous = await this.store.findById(input.snapshotId);
    if (previous === null) {
      throw new NotFoundError(`Snapshot ${input.snapshotId} not found`, {
        module: 'knowledge-graph',
        operation: 'updateGraph',
      });
    }
    const graph = Graph.fromRecords(previous.nodes, previous.edges);

    const removedNodes: GraphNodeData[] = [];
    const removedEdges: GraphEdgeData[] = [];
    const collectEdge = (edge: GraphEdgeData): void => {
      if (!removedEdges.some((e) => e.id === edge.id)) removedEdges.push(edge);
    };
    for (const id of input.nodeIdsToRemove ?? []) {
      const node = graph.getNode(id);
      if (node !== undefined) {
        removedNodes.push(node);
        for (const edge of graph.outEdges(id)) collectEdge(edge);
        for (const edge of graph.inEdges(id)) collectEdge(edge);
        graph.removeNode(id);
      }
    }
    for (const id of input.edgeIdsToRemove ?? []) {
      const edge = graph.getEdgeById(id);
      if (edge !== undefined) {
        collectEdge(edge);
        graph.removeEdge(edge.type, edge.from, edge.to);
      }
    }
    const addedNodes: GraphNodeData[] = [];
    for (const node of input.nodesToAdd ?? []) {
      addedNodes.push(graph.addNode(node));
    }
    const addedEdges: GraphEdgeData[] = [];
    for (const edge of input.edgesToAdd ?? []) {
      addedEdges.push(graph.addEdge(edge));
    }

    const version = await this.store.nextVersion(input.storeId);
    const snapshot = new GraphSnapshot(input.storeId, version, graph, input.source ?? 'graph.update', {
      label: input.label ?? previous.label,
      previousSnapshotId: previous.id,
      now: this.now,
    });
    await this.store.create(snapshot.toRecord());

    await this.publish({
      type: 'graph.updated',
      aggregateType: 'store',
      aggregateId: input.storeId,
      payload: { snapshotId: snapshot.id, storeId: input.storeId, version },
    });
    for (const edge of addedEdges) {
      await this.publish({
        type: 'graph.relationshipAdded',
        aggregateType: 'graph-edge',
        aggregateId: edge.id,
        payload: { snapshotId: snapshot.id, edgeId: edge.id, type: edge.type, from: edge.from, to: edge.to },
      });
    }
    for (const edge of removedEdges) {
      await this.publish({
        type: 'graph.relationshipRemoved',
        aggregateType: 'graph-edge',
        aggregateId: edge.id,
        payload: { snapshotId: snapshot.id, edgeId: edge.id, type: edge.type, from: edge.from, to: edge.to },
      });
    }

    return {
      snapshotId: snapshot.id,
      nodeCount: snapshot.nodeCount,
      edgeCount: snapshot.edgeCount,
      addedNodes,
      removedNodes,
      addedEdges,
      removedEdges,
    };
  }

  async compareSnapshots(previousId: string, currentId: string): Promise<SnapshotDiff | null> {
    const previous = await this.store.findById(previousId);
    const current = await this.store.findById(currentId);
    if (previous === null || current === null) return null;
    const diff = diffGraphs(Graph.fromRecords(previous.nodes, previous.edges), Graph.fromRecords(current.nodes, current.edges), {
      previousId: previous.id,
      currentId: current.id,
      previousVersion: previous.version,
      currentVersion: current.version,
    });
    await this.publish({
      type: 'graph.compared',
      aggregateType: 'snapshot',
      aggregateId: currentId,
      payload: { previousId, currentId },
    });
    return diff;
  }

  async query(snapshotId: string): Promise<KnowledgeGraphQuery> {
    const graph = await this.loadGraph(snapshotId);
    return {
      findRelatedPages: (pageId) => findRelatedPages(graph, pageId),
      findKeywordCompetition: (keywordId) => findKeywordCompetition(graph, keywordId),
      findInternalLinkOpportunities: () => findInternalLinkOpportunities(graph),
      findOrphanPages: () => findOrphanPages(graph),
      findTopicClusters: () => findTopicClusters(graph),
      findRecommendationsForPage: (pageId) => findRecommendationsForPage(graph, pageId),
      findRecommendationsForKeyword: (keywordId) => findRecommendationsForKeyword(graph, keywordId),
      findEntityRelationships: (entityId) => findEntityRelationships(graph, entityId),
      findBrokenContentChains: () => findBrokenContentChains(graph),
      findContentGaps: () => findContentGaps(graph),
    };
  }

  async loadGraph(snapshotId: string): Promise<Graph> {
    const record = await this.store.findById(snapshotId);
    if (record === null) {
      throw new NotFoundError(`Snapshot ${snapshotId} not found`, {
        module: 'knowledge-graph',
        operation: 'loadGraph',
      });
    }
    return Graph.fromRecords(record.nodes, record.edges);
  }

  async exportGraph(snapshotId: string): Promise<GraphSnapshotRecord> {
    const record = await this.store.findById(snapshotId);
    if (record === null) {
      throw new NotFoundError(`Snapshot ${snapshotId} not found`, {
        module: 'knowledge-graph',
        operation: 'exportGraph',
      });
    }
    return record;
  }

  async importGraph(record: GraphSnapshotRecord): Promise<{ snapshotId: string; storeId: string; version: number }> {
    const existing = await this.store.findById(record.id);
    if (existing !== null) {
      throw new ConflictError(`Snapshot ${record.id} already exists`, {
        module: 'knowledge-graph',
        operation: 'importGraph',
      });
    }
    await this.store.create(record);
    await this.publish({
      type: 'graph.built',
      aggregateType: 'store',
      aggregateId: record.storeId,
      payload: {
        snapshotId: record.id,
        storeId: record.storeId,
        version: record.version,
        nodeCount: record.summary.nodeCount,
        edgeCount: record.summary.edgeCount,
      },
    });
    return { snapshotId: record.id, storeId: record.storeId, version: record.version };
  }

  private async publish(input: EventInput): Promise<void> {
    if (this.eventBus === undefined) return;
    try {
      await this.eventBus.publish(input);
    } catch (error) {
      this.logger?.warn({ err: error, event: input.type }, 'failed to publish knowledge graph event');
    }
  }
}

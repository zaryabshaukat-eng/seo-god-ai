import type { EnginePageInput } from '@seogod/seo-engine';
import type { Recommendation } from '@seogod/seo-engine';
import type { GraphEdgeData, GraphNodeData } from './graph.js';
import type { SnapshotDiff } from './snapshot.js';

/** Deterministic keyword mapping provided by callers (no NLP in this package). */
export interface KeywordInput {
  text: string;
  searchIntent?: string;
  /** Page/product URLs this keyword is targeted at. */
  targetUrls?: string[];
  /** Optional metrics, e.g. search volume, competition (0..1). */
  searchVolume?: number;
  competition?: number;
}

/** Optional explicit entity inputs (entities are also derived from schema). */
export interface EntityInput {
  name: string;
  /** Node type the entity describes, default 'entity'. */
  nodeType?: 'entity' | 'product' | 'collection' | 'article';
  /** Page URLs that contain this entity. */
  pageUrls?: string[];
}

/** Optional video media discovered outside the crawler. */
export interface VideoInput {
  url: string;
  sourcePageUrl: string;
}

/** Optional agent run that generated recommendations. */
export interface AgentRunInput {
  id: string;
  agentName: string;
  status: string;
  recommendationIds?: string[];
}

/**
 * Everything needed to build a knowledge-graph snapshot from one crawl plus
 * the SEO engine's recommendations. Fully deterministic.
 */
export interface GraphBuildInput {
  storeId: string;
  crawlJobId: string;
  /** Crawled pages with extractions and detected issues. */
  pages: EnginePageInput[];
  /** SEO engine recommendations for the same crawl. */
  recommendations: Recommendation[];
  keywords?: KeywordInput[];
  entities?: EntityInput[];
  videos?: VideoInput[];
  agentRuns?: AgentRunInput[];
  /** Provenance label, default 'crawl.completed'. */
  source?: string;
  /** Optional label for the snapshot. */
  label?: string;
  /** Sanitized build metadata. */
  metadata?: Record<string, unknown>;
}

/** Additive update to an existing snapshot's graph. */
export interface GraphUpdateInput {
  storeId: string;
  snapshotId: string;
  nodesToAdd?: NodeInputForUpdate[];
  edgesToAdd?: EdgeInputForUpdate[];
  /** Edge ids to remove. */
  edgeIdsToRemove?: string[];
  /** Node ids to remove (incident edges are removed too). */
  nodeIdsToRemove?: string[];
  source?: string;
  label?: string;
}

export type NodeInputForUpdate = GraphNodeData;
export type EdgeInputForUpdate = GraphEdgeData;

export interface GraphBuildResult {
  snapshotId: string;
  storeId: string;
  version: number;
  nodeCount: number;
  edgeCount: number;
  previousSnapshotId: string | null;
  diff: SnapshotDiff | null;
}

export interface GraphUpdateResult {
  snapshotId: string;
  nodeCount: number;
  edgeCount: number;
  addedNodes: GraphNodeData[];
  removedNodes: GraphNodeData[];
  addedEdges: GraphEdgeData[];
  removedEdges: GraphEdgeData[];
}

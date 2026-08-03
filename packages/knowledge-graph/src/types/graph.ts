/**
 * Core node and edge types for the SEO knowledge graph. These are the
 * canonical, language-neutral contracts every consumer reasons over.
 */

/** Every node kind the knowledge graph understands. */
export type NodeType =
  | 'store'
  | 'website'
  | 'collection'
  | 'product'
  | 'page'
  | 'article'
  | 'blog'
  | 'keyword'
  | 'search-intent'
  | 'entity'
  | 'topic-cluster'
  | 'schema'
  | 'image'
  | 'video'
  | 'internal-link'
  | 'external-link'
  | 'seo-issue'
  | 'seo-recommendation'
  | 'crawl'
  | 'audit'
  | 'report'
  | 'agent-run';

/** Every relationship kind the knowledge graph understands. */
export type EdgeType =
  | 'owns'
  | 'contains'
  | 'crawled'
  | 'links_to'
  | 'references'
  | 'targets'
  | 'belongs_to'
  | 'fixes'
  | 'affects'
  | 'describes'
  | 'generated'
  | 'occurs_in'
  | 'derived_from';

export const NODE_TYPES: readonly NodeType[] = [
  'store',
  'website',
  'collection',
  'product',
  'page',
  'article',
  'blog',
  'keyword',
  'search-intent',
  'entity',
  'topic-cluster',
  'schema',
  'image',
  'video',
  'internal-link',
  'external-link',
  'seo-issue',
  'seo-recommendation',
  'crawl',
  'audit',
  'report',
  'agent-run',
];

export const EDGE_TYPES: readonly EdgeType[] = [
  'owns',
  'contains',
  'crawled',
  'links_to',
  'references',
  'targets',
  'belongs_to',
  'fixes',
  'affects',
  'describes',
  'generated',
  'occurs_in',
  'derived_from',
];

export function isNodeType(value: string): value is NodeType {
  return (NODE_TYPES as readonly string[]).includes(value);
}

export function isEdgeType(value: string): value is EdgeType {
  return (EDGE_TYPES as readonly string[]).includes(value);
}

/** A node in the knowledge graph. */
export interface GraphNodeData {
  /** Deterministic UUID: uuid5('node:' + type, externalId). */
  id: string;
  type: NodeType;
  /** Stable business key within a type (normalized URL, slug, text key). */
  externalId: string;
  name: string | null;
  properties: Record<string, unknown>;
  /** Provenance: which crawler/engine/import data produced this node. */
  source: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A directed relationship between two nodes. */
export interface GraphEdgeData {
  /** Deterministic UUID: uuid5('edge:' + type, fromId + '\u0000' + toId). */
  id: string;
  type: EdgeType;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  /** 0..1 relationship strength. */
  weight: number;
  /** 0..1 confidence in the relationship's existence. */
  confidence: number;
  /** Provenance: which builder/rule produced this edge. */
  source: string;
  /** Evidence + explainability metadata (sanitized). */
  properties: Record<string, unknown>;
  createdAt: Date;
}

/** Input used to create/update a node (id derived when omitted). */
export interface NodeInput {
  type: NodeType;
  externalId: string;
  name?: string | null;
  properties?: Record<string, unknown>;
  source: string;
  id?: string;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Input used to create/update an edge (id derived when omitted). */
export interface EdgeInput {
  type: EdgeType;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  weight?: number;
  confidence?: number;
  source: string;
  properties?: Record<string, unknown>;
  id?: string;
  createdAt?: Date;
}

/** Human-readable provenance answer for a single relationship. */
export interface RelationshipExplanation {
  relationship: string;
  reason: string;
  evidence: Record<string, unknown>;
  source: string;
  /** SEO rules (crawler/seo-engine rule ids) that reference this relationship. */
  rules: string[];
  /** Recommendation ids that depend on this relationship. */
  dependsOnRecommendations: string[];
}

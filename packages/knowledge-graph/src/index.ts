// Knowledge graph types
export {
  NODE_TYPES,
  EDGE_TYPES,
  isNodeType,
  isEdgeType,
} from './types/graph.js';
export type {
  NodeType,
  EdgeType,
  GraphNodeData,
  GraphEdgeData,
  NodeInput,
  EdgeInput,
  RelationshipExplanation,
} from './types/graph.js';
export type {
  GraphSnapshotRecord,
  SnapshotDiff,
} from './types/snapshot.js';
export type {
  GraphBuildInput,
  GraphUpdateInput,
  GraphBuildResult,
  GraphUpdateResult,
  KeywordInput,
  EntityInput,
  VideoInput,
  AgentRunInput,
  NodeInputForUpdate,
  EdgeInputForUpdate,
} from './types/input.js';

// Utils
export {
  deterministicUuid,
  nodeId,
  edgeId,
  newId,
  isUuid,
} from './utils/ids.js';
export { sanitizeMetadata } from './utils/sanitize.js';
export { validateNodeInput, validateEdgeInput } from './utils/validation.js';

// Relationship registry
export {
  relationshipDefinition,
  nodeTypeDefinition,
  isAllowedPair,
  assertAllowedPair,
  relationshipRegistry,
  nodeTypeRegistry,
} from './relationships/registry.js';
export type { RelationshipDefinition, NodeTypeDefinition } from './relationships/registry.js';

// Models
export { Graph } from './models/graph.js';
export type { GraphOptions } from './models/graph.js';
export { GraphSnapshot } from './models/snapshot.js';
export type { GraphSnapshotOptions } from './models/snapshot.js';

// Graph algorithms
export {
  connectedComponents,
  internalLinkDepth,
  identifyHubs,
  estimateAuthorityFlow,
  discoverTopicClusters,
  findDuplicateTargets,
  recommendationDependencyGraph,
  nodesByType,
} from './graph/algorithms.js';
export type {
  OrphanPage,
  Hub,
  AuthorityFlowOptions,
  TopicCluster,
  DuplicateTarget,
  RecommendationDependency,
} from './graph/algorithms.js';
export { diffGraphs } from './graph/diff.js';
export type { DiffContext } from './graph/diff.js';

// Builders
export { GraphBuilder, buildGraph } from './builders/graph-builder.js';
export type { GraphBuilderOptions } from './builders/graph-builder.js';

// Queries
export {
  findRelatedPages,
  findKeywordCompetition,
  findInternalLinkOpportunities,
  findOrphanPages,
  findTopicClusters,
  findRecommendationsForPage,
  findRecommendationsForKeyword,
  findEntityRelationships,
  findBrokenContentChains,
  findContentGaps,
} from './queries/queries.js';
export type {
  RelatedPage,
  KeywordCompetition,
  LinkOpportunity,
  PageRecommendation,
  KeywordRecommendation,
  EntityRelationship,
  BrokenChain,
  ContentGap,
} from './queries/queries.js';

// Persistence
export { PrismaGraphSnapshotStore } from './persistence/graph-snapshot-store.js';
export type { GraphSnapshotStore } from './persistence/graph-snapshot-store.js';

// Scoring
export {
  pageImportance,
  keywordOpportunity,
  rankRecommendations,
  authorityContribution,
} from './scoring/scoring.js';
export type {
  PageImportance,
  KeywordOpportunity,
  RankedRecommendation,
} from './scoring/scoring.js';

// Service
export { KnowledgeGraphService } from './services/knowledge-graph-service.js';
export type {
  KnowledgeGraphQuery,
  KnowledgeGraphServiceOptions,
} from './services/knowledge-graph-service.js';

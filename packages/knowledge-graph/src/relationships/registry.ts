import { ValidationError } from '@seogod/core';
import type { EdgeType, NodeType } from '../types/graph.js';
import { NODE_TYPES } from '../types/graph.js';

export interface RelationshipDefinition {
  type: EdgeType;
  label: string;
  description: string;
  /** Node types allowed as the relationship source. */
  allowedSources: readonly NodeType[];
  /** Node types allowed as the relationship target. */
  allowedTargets: readonly NodeType[];
  defaultWeight: number;
  defaultConfidence: number;
  /** What evidence creates this relationship. */
  evidenceHint: string;
}

export interface NodeTypeDefinition {
  type: NodeType;
  label: string;
  description: string;
}

const NODE_DEFINITIONS: Record<NodeType, NodeTypeDefinition> = {
  store: { type: 'store', label: 'Store', description: 'A connected Shopify store.' },
  website: { type: 'website', label: 'Website', description: 'The store website origin.' },
  collection: { type: 'collection', label: 'Collection', description: 'A product collection page.' },
  product: { type: 'product', label: 'Product', description: 'A product page.' },
  page: { type: 'page', label: 'Page', description: 'A crawled page.' },
  article: { type: 'article', label: 'Article', description: 'A blog article page.' },
  blog: { type: 'blog', label: 'Blog', description: 'A blog index page.' },
  keyword: { type: 'keyword', label: 'Keyword', description: 'A target search keyword.' },
  'search-intent': { type: 'search-intent', label: 'Search Intent', description: 'A search intent bucket.' },
  entity: { type: 'entity', label: 'Entity', description: 'A named entity extracted from content.' },
  'topic-cluster': { type: 'topic-cluster', label: 'Topic Cluster', description: 'A cluster of related pages.' },
  schema: { type: 'schema', label: 'Schema', description: 'A structured-data block.' },
  image: { type: 'image', label: 'Image', description: 'An image referenced by a page.' },
  video: { type: 'video', label: 'Video', description: 'A video referenced by a page.' },
  'internal-link': { type: 'internal-link', label: 'Internal Link', description: 'An internal link edge holder.' },
  'external-link': { type: 'external-link', label: 'External Link', description: 'An outbound external link.' },
  'seo-issue': { type: 'seo-issue', label: 'SEO Issue', description: 'A detected SEO issue.' },
  'seo-recommendation': { type: 'seo-recommendation', label: 'SEO Recommendation', description: 'A prioritized SEO recommendation.' },
  crawl: { type: 'crawl', label: 'Crawl', description: 'A crawl run.' },
  audit: { type: 'audit', label: 'Audit', description: 'An audit run.' },
  report: { type: 'report', label: 'Report', description: 'A report document.' },
  'agent-run': { type: 'agent-run', label: 'Agent Run', description: 'An AI agent execution.' },
};

const PAGE_KINDS = ['store', 'website', 'collection', 'product', 'page', 'article', 'blog'] as const;

const RELATIONSHIPS: Record<EdgeType, RelationshipDefinition> = {
  owns: {
    type: 'owns',
    label: 'owns',
    description: 'A store owns its website, collections, products, and content pages.',
    allowedSources: ['store'],
    allowedTargets: PAGE_KINDS,
    defaultWeight: 1,
    defaultConfidence: 1,
    evidenceHint: 'Store membership: every node carries the storeId of its crawl.',
  },
  contains: {
    type: 'contains',
    label: 'contains',
    description: 'A collection contains products; a blog contains articles; a page contains entities/schema.',
    allowedSources: ['store', 'website', 'collection', 'blog', 'page', 'product', 'article'],
    allowedTargets: ['product', 'article', 'entity', 'schema', 'page', 'blog'],
    defaultWeight: 1,
    defaultConfidence: 1,
    evidenceHint: 'Link structure and page types observed during the crawl.',
  },
  crawled: {
    type: 'crawled',
    label: 'crawled',
    description: 'A crawl discovered a page.',
    allowedSources: ['crawl'],
    allowedTargets: ['page', 'product', 'collection', 'article', 'blog', 'website'],
    defaultWeight: 1,
    defaultConfidence: 1,
    evidenceHint: 'Crawl job produced the page snapshot.',
  },
  links_to: {
    type: 'links_to',
    label: 'links to',
    description: 'A page links to another page, image, video, or external resource.',
    allowedSources: ['page', 'product', 'collection', 'article', 'blog', 'website'],
    allowedTargets: ['page', 'product', 'collection', 'article', 'blog', 'website', 'image', 'video', 'external-link'],
    defaultWeight: 0.8,
    defaultConfidence: 1,
    evidenceHint: 'Anchor href extracted from the source page HTML.',
  },
  references: {
    type: 'references',
    label: 'references',
    description: 'A page references an image or video asset.',
    allowedSources: ['page', 'product', 'collection', 'article', 'blog', 'website'],
    allowedTargets: ['image', 'video'],
    defaultWeight: 0.6,
    defaultConfidence: 1,
    evidenceHint: 'Media element src extracted from the page HTML.',
  },
  targets: {
    type: 'targets',
    label: 'targets',
    description: 'A product or page targets a keyword.',
    allowedSources: ['product', 'page', 'collection'],
    allowedTargets: ['keyword'],
    defaultWeight: 0.9,
    defaultConfidence: 0.7,
    evidenceHint: 'Explicit keyword mapping provided as builder input.',
  },
  belongs_to: {
    type: 'belongs_to',
    label: 'belongs to',
    description: 'A keyword belongs to a search intent; content belongs to a topic cluster.',
    allowedSources: ['keyword', 'article', 'page', 'product'],
    allowedTargets: ['search-intent', 'topic-cluster'],
    defaultWeight: 0.8,
    defaultConfidence: 0.7,
    evidenceHint: 'Keyword intent mapping or cluster membership.',
  },
  fixes: {
    type: 'fixes',
    label: 'fixes',
    description: 'A recommendation fixes a detected SEO issue.',
    allowedSources: ['seo-recommendation'],
    allowedTargets: ['seo-issue'],
    defaultWeight: 1,
    defaultConfidence: 0.9,
    evidenceHint: 'Recommendation rule matches the issue rule on an affected page.',
  },
  affects: {
    type: 'affects',
    label: 'affects',
    description: 'An issue or recommendation affects a page.',
    allowedSources: ['seo-issue', 'seo-recommendation'],
    allowedTargets: ['page', 'product', 'collection', 'article', 'blog', 'website'],
    defaultWeight: 0.9,
    defaultConfidence: 0.95,
    evidenceHint: 'Issue detected on the page or recommendation affectedUrls.',
  },
  describes: {
    type: 'describes',
    label: 'describes',
    description: 'A schema block describes a product or entity.',
    allowedSources: ['schema'],
    allowedTargets: ['product', 'entity', 'collection', 'article'],
    defaultWeight: 0.8,
    defaultConfidence: 0.8,
    evidenceHint: 'Structured-data schemaType on the page.',
  },
  generated: {
    type: 'generated',
    label: 'generated',
    description: 'An agent run generated recommendations.',
    allowedSources: ['agent-run'],
    allowedTargets: ['seo-recommendation'],
    defaultWeight: 1,
    defaultConfidence: 0.9,
    evidenceHint: 'Agent run output references the recommendation id.',
  },
  occurs_in: {
    type: 'occurs_in',
    label: 'occurs in',
    description: 'An issue or recommendation occurred during a crawl.',
    allowedSources: ['seo-issue', 'seo-recommendation'],
    allowedTargets: ['crawl'],
    defaultWeight: 1,
    defaultConfidence: 1,
    evidenceHint: 'The crawl job that produced the issue or recommendation.',
  },
  derived_from: {
    type: 'derived_from',
    label: 'derived from',
    description: 'A recommendation is derived from a crawl snapshot.',
    allowedSources: ['seo-recommendation', 'audit', 'report'],
    allowedTargets: ['crawl'],
    defaultWeight: 1,
    defaultConfidence: 1,
    evidenceHint: 'The crawl data that produced the recommendation.',
  },
};

/** Returns the definition for a relationship type. */
export function relationshipDefinition(type: EdgeType): RelationshipDefinition {
  return RELATIONSHIPS[type];
}

/** Returns the definition for a node type. */
export function nodeTypeDefinition(type: NodeType): NodeTypeDefinition {
  return NODE_DEFINITIONS[type];
}

/** True when the (sourceType, targetType) pair is valid for the edge type. */
export function isAllowedPair(type: EdgeType, sourceType: NodeType, targetType: NodeType): boolean {
  const definition = RELATIONSHIPS[type];
  if (definition.allowedSources.length > 0 && !definition.allowedSources.includes(sourceType)) return false;
  if (definition.allowedTargets.length > 0 && !definition.allowedTargets.includes(targetType)) return false;
  return true;
}

/** Throws when an edge would connect an invalid pair of node types. */
export function assertAllowedPair(type: EdgeType, sourceType: NodeType, targetType: NodeType): void {
  if (!isAllowedPair(type, sourceType, targetType)) {
    throw new ValidationError(`Edge "${type}" cannot connect "${sourceType}" to "${targetType}"`, {
      module: 'knowledge-graph',
      operation: 'assertAllowedPair',
      context: { type, sourceType, targetType },
    });
  }
}

/** All known relationship definitions. */
export function relationshipRegistry(): readonly RelationshipDefinition[] {
  return Object.values(RELATIONSHIPS);
}

/** All known node type definitions. */
export function nodeTypeRegistry(): readonly NodeTypeDefinition[] {
  return NODE_TYPES.map((type) => NODE_DEFINITIONS[type]);
}

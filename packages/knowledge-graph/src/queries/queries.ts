import { estimateAuthorityFlow, findOrphanPages, internalLinkDepth } from '../graph/algorithms.js';
export { findOrphanPages } from '../graph/algorithms.js';
export { discoverTopicClusters as findTopicClusters } from '../graph/algorithms.js';
import type { Graph } from '../models/graph.js';
import type { GraphNodeData, NodeType } from '../types/graph.js';

const CONTENT_KINDS: readonly NodeType[] = ['product', 'collection', 'page', 'article', 'blog'];

function isContentKind(node: GraphNodeData): boolean {
  return CONTENT_KINDS.includes(node.type);
}

function pageUrl(node: GraphNodeData): string {
  return typeof node.properties.url === 'string' ? node.properties.url : node.externalId;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export interface RelatedPage {
  pageId: string;
  url: string;
  type: NodeType;
  reasons: string[];
  strength: number;
}

/** Pages related to a page via shared entities, mutual links, or collections. */
export function findRelatedPages(graph: Graph, pageId: string): RelatedPage[] {
  const page = graph.getNode(pageId);
  if (page === undefined) return [];

  const signals = new Map<string, Set<string>>();
  const addSignal = (id: string, reason: string): void => {
    if (id === pageId) return;
    const reasons = signals.get(id) ?? new Set<string>();
    reasons.add(reason);
    signals.set(id, reasons);
  };

  for (const edge of graph.outEdges(pageId)) {
    if (edge.type !== 'contains') continue;
    const entity = graph.getNode(edge.to);
    if (entity === undefined || entity.type !== 'entity') continue;
    for (const inbound of graph.inEdges(entity.id)) {
      if (inbound.type === 'contains') addSignal(inbound.from, `shares:${entity.externalId}`);
    }
  }

  for (const edge of graph.outEdges(pageId)) {
    if (edge.type !== 'links_to') continue;
    if (graph.hasEdge('links_to', edge.to, pageId)) addSignal(edge.to, 'mutual-link');
  }

  const collections = graph
    .inEdges(pageId)
    .filter((edge) => edge.type === 'contains' && graph.getNode(edge.from)?.type === 'collection')
    .map((edge) => edge.from);
  for (const collectionId of collections) {
    for (const edge of graph.outEdges(collectionId)) {
      if (edge.type === 'contains') addSignal(edge.to, 'shared-collection');
    }
  }

  return [...signals.entries()]
    .map(([id, reasons]) => {
      const node = graph.getNode(id);
      /* v8 ignore next 1 -- defensive: signal ids are live edge endpoints */
      if (node === undefined) return null;
      return {
        pageId: id,
        url: pageUrl(node),
        type: node.type,
        reasons: [...reasons].sort(),
        strength: reasons.size,
      };
    })
    .filter((entry): entry is RelatedPage => entry !== null)
    .sort((a, b) => b.strength - a.strength || a.pageId.localeCompare(b.pageId));
}

export interface KeywordCompetition {
  keywordId: string;
  keyword: string;
  competitors: Array<{ pageId: string; url: string; type: NodeType }>;
}

/** Content nodes competing for the same keyword. */
export function findKeywordCompetition(graph: Graph, keywordId: string): KeywordCompetition | null {
  const keyword = graph.getNode(keywordId);
  if (keyword === undefined || keyword.type !== 'keyword') return null;
  const competitors = graph
    .inEdges(keywordId)
    .filter((edge) => edge.type === 'targets')
    .map((edge) => {
      const node = graph.getNode(edge.from);
      /* v8 ignore next 1 -- defensive: targets edge endpoints are live */
      if (node === undefined) return null;
      return { pageId: node.id, url: pageUrl(node), type: node.type };
    })
    .filter((entry): entry is KeywordCompetition['competitors'][number] => entry !== null)
    .sort((a, b) => a.pageId.localeCompare(b.pageId));
  return {
    keywordId,
    keyword: asString(keyword.properties.keyword) ?? keyword.externalId,
    competitors,
  };
}

export interface LinkOpportunity {
  targetPage: string;
  targetUrl: string;
  type: NodeType;
  suggestions: Array<{ pageId: string; url: string; authority: number }>;
}

/** Orphan pages plus the highest-authority pages that should link to them. */
export function findInternalLinkOpportunities(graph: Graph, minOutLinks = 3): LinkOpportunity[] {
  const orphans = findOrphanPages(graph);
  const authority = estimateAuthorityFlow(graph);
  const ranked = [...authority.entries()].sort((a, b) => b[1] - a[1]);

  return orphans
    .map((orphan) => {
      const suggestions = ranked
        .filter(([id]) => id !== orphan.id && !graph.hasEdge('links_to', id, orphan.id))
        .slice(0, minOutLinks)
        .map(([id, score]) => {
          const node = graph.getNode(id);
          /* v8 ignore next 1 -- defensive: authority ids are live content nodes */
          return { pageId: id, url: node === undefined ? id : pageUrl(node), authority: score };
        });
      return {
        targetPage: orphan.id,
        targetUrl: orphan.url,
        type: orphan.type,
        suggestions,
      };
    })
    .sort((a, b) => a.targetPage.localeCompare(b.targetPage));
}

export interface PageRecommendation {
  recommendationId: string;
  rule: string;
  title: string;
  score: number;
  priority: string;
  fixes: string[];
}

/** Recommendations that affect a page and the issues they fix. */
export function findRecommendationsForPage(graph: Graph, pageId: string): PageRecommendation[] {
  const recommendations: PageRecommendation[] = [];
  for (const edge of graph.inEdges(pageId)) {
    if (edge.type !== 'affects') continue;
    const recommendation = graph.getNode(edge.from);
    if (recommendation === undefined || recommendation.type !== 'seo-recommendation') continue;
    const fixes = graph
      .outEdges(recommendation.id)
      .filter((out) => out.type === 'fixes')
      .map((out) => out.to);
    recommendations.push({
      recommendationId: recommendation.id,
      rule: asString(recommendation.properties.rule) ?? recommendation.externalId,
      title: recommendation.name ?? recommendation.externalId,
      score: typeof recommendation.properties.score === 'number' ? recommendation.properties.score : 0,
      priority: asString(recommendation.properties.priority) ?? 'LOW',
      fixes,
    });
  }
  return recommendations.sort((a, b) => b.score - a.score || a.recommendationId.localeCompare(b.recommendationId));
}

export interface KeywordRecommendation {
  recommendationId: string;
  rule: string;
  title: string;
  score: number;
  priority: string;
  affectedPages: string[];
}

/** Recommendations affecting pages that target a keyword. */
export function findRecommendationsForKeyword(graph: Graph, keywordId: string): KeywordRecommendation[] {
  const pages = graph
    .inEdges(keywordId)
    .filter((edge) => edge.type === 'targets')
    .map((edge) => edge.from);
  const byRecommendation = new Map<string, Set<string>>();
  const scores = new Map<string, { rule: string; title: string; score: number; priority: string }>();
  for (const pageId of pages) {
    for (const edge of graph.inEdges(pageId)) {
      if (edge.type !== 'affects') continue;
      const recommendation = graph.getNode(edge.from);
      if (recommendation === undefined || recommendation.type !== 'seo-recommendation') continue;
      const affected = byRecommendation.get(edge.from) ?? new Set<string>();
      affected.add(pageId);
      byRecommendation.set(edge.from, affected);
      scores.set(edge.from, {
        rule: asString(recommendation.properties.rule) ?? recommendation.externalId,
        title: recommendation.name ?? recommendation.externalId,
        score: typeof recommendation.properties.score === 'number' ? recommendation.properties.score : 0,
        priority: asString(recommendation.properties.priority) ?? 'LOW',
      });
    }
  }
  return [...byRecommendation.entries()]
    .map(([id, affectedPages]) => {
      const meta = scores.get(id);
      /* v8 ignore start -- defensive: byRecommendation and scores are populated together */
      return {
        recommendationId: id,
        rule: meta?.rule ?? id,
        title: meta?.title ?? id,
        score: meta?.score ?? 0,
        priority: meta?.priority ?? 'LOW',
        affectedPages: [...affectedPages].sort(),
      };
      /* v8 ignore stop */
    })
    .sort((a, b) => b.score - a.score || a.recommendationId.localeCompare(b.recommendationId));
}

export interface EntityRelationship {
  entityId: string;
  name: string;
  sharedPages: string[];
  strength: number;
}

/** Other entities co-occurring with an entity across pages. */
export function findEntityRelationships(graph: Graph, entityId: string): EntityRelationship[] {
  const entity = graph.getNode(entityId);
  if (entity === undefined) return [];
  const pages = graph
    .inEdges(entityId)
    .filter((edge) => edge.type === 'contains')
    .map((edge) => edge.from);
  const shared = new Map<string, Set<string>>();
  for (const pageId of pages) {
    for (const edge of graph.outEdges(pageId)) {
      if (edge.type !== 'contains') continue;
      if (edge.to === entityId) continue;
      const coNode = graph.getNode(edge.to);
      if (coNode === undefined || coNode.type !== 'entity') continue;
      const co = shared.get(edge.to) ?? new Set<string>();
      co.add(pageId);
      shared.set(edge.to, co);
    }
  }
  return [...shared.entries()]
    .map(([id, sharedPages]) => {
      const node = graph.getNode(id);
      return {
        entityId: id,
        /* v8 ignore next 1 -- defensive: shared entity ids are live nodes */
        name: node?.name ?? id,
        sharedPages: [...sharedPages].sort(),
        strength: sharedPages.size,
      };
    })
    .sort((a, b) => b.strength - a.strength || a.entityId.localeCompare(b.entityId));
}

export interface BrokenChain {
  pageId: string;
  url: string;
  type: NodeType;
  reason: 'no-inbound-links' | 'unreachable-from-root';
  depth: number | null;
}

/** Content chains that cannot be reached by following internal links. */
export function findBrokenContentChains(graph: Graph): BrokenChain[] {
  const website = graph.nodesArray().find((node) => node.type === 'website');
  const origin = website?.externalId;
  const home = graph
    .nodesArray()
    .find((node) => isContentKind(node) && (pageUrl(node) === origin || pageUrl(node) === `${origin}/`));
  const rootId = home?.id ?? website?.id;
  const depth = rootId === undefined ? new Map<string, number>() : internalLinkDepth(graph, rootId);
  const chains = new Map<string, BrokenChain>();
  for (const node of graph.nodesArray()) {
    if (!isContentKind(node)) continue;
    if (!depth.has(node.id)) {
      chains.set(node.id, {
        pageId: node.id,
        url: pageUrl(node),
        type: node.type,
        reason: 'unreachable-from-root',
        depth: depth.get(node.id) ?? null,
      });
    }
  }
  for (const orphan of findOrphanPages(graph)) {
    /* v8 ignore next 1 -- orphans lack inbound links so they are never in `depth` */
    if (chains.has(orphan.id)) continue;
    chains.set(orphan.id, {
      pageId: orphan.id,
      url: orphan.url,
      type: orphan.type,
      reason: 'no-inbound-links',
      depth: depth.get(orphan.id) ?? null,
    });
  }
  return [...chains.values()].sort((a, b) => a.pageId.localeCompare(b.pageId));
}

export interface ContentGap {
  type: 'untargeted-keyword';
  keywordId: string;
  keyword: string;
}

/** Content gaps: keywords that no page targets. */
export function findContentGaps(graph: Graph): ContentGap[] {
  const gaps: ContentGap[] = [];
  for (const node of graph.nodesArray()) {
    if (node.type !== 'keyword') continue;
    const targeting = graph.inEdges(node.id).filter((edge) => edge.type === 'targets');
    if (targeting.length === 0) {
      gaps.push({
        type: 'untargeted-keyword',
        keywordId: node.id,
        keyword: asString(node.properties.keyword) ?? node.externalId,
      });
    }
  }
  return gaps.sort((a, b) => a.keywordId.localeCompare(b.keywordId));
}

import { estimateAuthorityFlow } from '../graph/algorithms.js';
import type { Graph } from '../models/graph.js';
import type { GraphNodeData } from '../types/graph.js';

const CONTENT_KINDS: readonly GraphNodeData['type'][] = ['product', 'collection', 'page', 'article', 'blog'];

function isContentKind(node: GraphNodeData): boolean {
  return CONTENT_KINDS.includes(node.type);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pageUrl(node: GraphNodeData): string {
  return typeof node.properties.url === 'string' ? node.properties.url : node.externalId;
}

export interface PageImportance {
  pageId: string;
  url: string;
  authority: number;
  authorityPercentile: number;
  inboundLinks: number;
  recommendations: number;
  importance: number;
}

/**
 * Graph-aware importance of a content page (0..100). Combines authority-flow
 * percentile (60%), inbound internal links (25%), and recommendation coverage
 * (15%). Higher inbound links and higher flow always mean higher importance.
 */
export function pageImportance(graph: Graph, pageId: string): PageImportance | null {
  const page = graph.getNode(pageId);
  if (page === undefined || !isContentKind(page)) return null;

  const authority = estimateAuthorityFlow(graph);
  const ranked = [...authority.entries()].sort((a, b) => a[1] - b[1]);
  const position = ranked.findIndex(([id]) => id === pageId);
  /* v8 ignore next 1 -- defensive: content pages always appear in authority flow */
  const authorityValue = authority.get(pageId) ?? 0;
  const authorityPercentile = ranked.length <= 1 ? 100 : (position / (ranked.length - 1)) * 100;

  const inboundLinks = graph.inEdges(pageId).filter((edge) => edge.type === 'links_to').length;
  const recommendations = graph
    .inEdges(pageId)
    .filter((edge) => edge.type === 'affects' && graph.getNode(edge.from)?.type === 'seo-recommendation').length;

  const importance = clamp(
    Math.round(0.6 * authorityPercentile + 0.25 * Math.min((inboundLinks / 10) * 100, 100) + 0.15 * Math.min((recommendations / 5) * 100, 100)),
    0,
    100,
  );

  return {
    pageId,
    url: pageUrl(page),
    authority: authorityValue,
    authorityPercentile: Math.round(authorityPercentile * 100) / 100,
    inboundLinks,
    recommendations,
    importance,
  };
}

export interface KeywordOpportunity {
  keywordId: string;
  keyword: string;
  searchVolume: number | null;
  competition: number;
  targetingPages: number;
  targetingAuthority: number;
  opportunity: number;
}

/**
 * Opportunity score for a keyword (0..100). Lower internal competition and
 * higher targeting authority raise the score; search volume adds a bounded
 * bonus.
 */
export function keywordOpportunity(graph: Graph, keywordId: string): KeywordOpportunity | null {
  const keyword = graph.getNode(keywordId);
  if (keyword === undefined || keyword.type !== 'keyword') return null;

  const authority = estimateAuthorityFlow(graph);
  const targeting = graph
    .inEdges(keywordId)
    .filter((edge) => edge.type === 'targets')
    .map((edge) => edge.from);
  const competition = targeting.length;
  const targetingAuthority = targeting.reduce((sum, id) => sum + (authority.get(id) ?? 0), 0);
  const searchVolume = typeof keyword.properties.searchVolume === 'number' ? keyword.properties.searchVolume : null;

  const competitionScore = Math.min((competition / 3) * 100, 100);
  const volumeBonus = searchVolume === null ? 0 : Math.min(searchVolume / 1000, 20);
  const authorityBonus = Math.min(targetingAuthority * 1000, 10);
  const opportunity = clamp(Math.round(50 + volumeBonus + authorityBonus - competitionScore), 0, 100);

  return {
    keywordId,
    keyword: typeof keyword.properties.keyword === 'string' ? keyword.properties.keyword : keyword.externalId,
    searchVolume,
    competition,
    targetingPages: competition,
    targetingAuthority,
    opportunity,
  };
}

export interface RankedRecommendation {
  recommendationId: string;
  rule: string;
  title: string;
  baseScore: number;
  affectedPages: number;
  affectedAuthority: number;
  graphScore: number;
  finalScore: number;
}

/**
 * Re-ranks recommendations using graph signals: authority of affected pages
 * (70% of the graph component) and number of affected pages (30%). The final
 * score blends the engine's base score (60%) with the graph score (40%).
 */
export function rankRecommendations(graph: Graph): RankedRecommendation[] {
  const authority = estimateAuthorityFlow(graph);
  const ranked: RankedRecommendation[] = [];
  for (const node of graph.nodesArray()) {
    if (node.type !== 'seo-recommendation') continue;
    const affected = graph
      .outEdges(node.id)
      .filter((edge) => edge.type === 'affects')
      .map((edge) => edge.to)
      .filter((id) => {
        const target = graph.getNode(id);
        return target !== undefined && isContentKind(target);
      });
    const affectedAuthority = affected.reduce((sum, id) => sum + (authority.get(id) ?? 0), 0);
    const graphScore = clamp(
      Math.round(0.7 * affectedAuthority * 100 + 0.3 * Math.min((affected.length / 5) * 100, 100)),
      0,
      100,
    );
    const baseScore = typeof node.properties.score === 'number' ? node.properties.score : 0;
    ranked.push({
      recommendationId: node.externalId,
      rule: typeof node.properties.rule === 'string' ? node.properties.rule : node.externalId,
      title: node.name ?? node.externalId,
      baseScore,
      affectedPages: affected.length,
      affectedAuthority: affectedAuthority,
      graphScore,
      finalScore: clamp(Math.round(0.6 * baseScore + 0.4 * graphScore), 0, 100),
    });
  }
  return ranked.sort((a, b) => b.finalScore - a.finalScore || a.recommendationId.localeCompare(b.recommendationId));
}

/** The share of `from`'s authority that flows to `to` via one link edge. */
export function authorityContribution(graph: Graph, fromId: string, toId: string): number {
  /* v8 ignore next 1 -- defensive: callers pass live content nodes */
  const authority = estimateAuthorityFlow(graph).get(fromId) ?? 0;
  const outLinks = graph.outEdges(fromId).filter((edge) => edge.type === 'links_to');
  const totalWeight = outLinks.reduce((sum, edge) => sum + edge.weight, 0);
  if (totalWeight === 0) return 0;
  const edge = graph.getEdge('links_to', fromId, toId);
  if (edge === undefined) return 0;
  return authority * (edge.weight / totalWeight);
}

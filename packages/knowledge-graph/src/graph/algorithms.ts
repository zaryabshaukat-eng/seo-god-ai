import type { Graph } from '../models/graph.js';
import { NODE_TYPES } from '../types/graph.js';
import type { EdgeType, GraphNodeData, NodeType } from '../types/graph.js';

const CONTENT_KINDS: readonly NodeType[] = ['product', 'collection', 'page', 'article', 'blog'];

function isContentKind(node: GraphNodeData): boolean {
  return CONTENT_KINDS.includes(node.type);
}

function isLinksToEdge(edgeType: EdgeType): boolean {
  return edgeType === 'links_to';
}

/** Groups node ids by undirected connectivity (union-find over all edges). */
export function connectedComponents(graph: Graph): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
    let current = id;
    while (current !== root) {
      const next = parent.get(current) ?? current;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const node of graph.nodesArray()) parent.set(node.id, node.id);
  for (const edge of graph.edgesArray()) union(edge.from, edge.to);

  const groups = new Map<string, string[]>();
  for (const node of graph.nodesArray()) {
    const root = find(node.id);
    const group = groups.get(root) ?? [];
    group.push(node.id);
    groups.set(root, group);
  }
  return [...groups.values()].map((ids) => ids.sort());
}

export interface OrphanPage {
  id: string;
  url: string;
  type: NodeType;
  inLinks: number;
}

/** Content pages with zero inbound internal links. */
export function findOrphanPages(graph: Graph): OrphanPage[] {
  const orphans: OrphanPage[] = [];
  for (const node of graph.nodesArray()) {
    if (!isContentKind(node)) continue;
    const inbound = graph.inEdges(node.id).filter((edge) => isLinksToEdge(edge.type));
    if (inbound.length === 0) {
      orphans.push({
        id: node.id,
        url: typeof node.properties.url === 'string' ? node.properties.url : node.externalId,
        type: node.type,
        inLinks: 0,
      });
    }
  }
  return orphans.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Shortest-path depth from a root page following `links_to` edges.
 * Unreachable pages are absent from the returned map.
 */
export function internalLinkDepth(graph: Graph, rootId: string): Map<string, number> {
  const depth = new Map<string, number>();
  if (!graph.hasNode(rootId)) return depth;
  const queue: string[] = [rootId];
  depth.set(rootId, 0);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const currentDepth = depth.get(current) ?? 0;
    for (const edge of graph.outEdges(current)) {
      if (!isLinksToEdge(edge.type)) continue;
      if (depth.has(edge.to)) continue;
      depth.set(edge.to, currentDepth + 1);
      queue.push(edge.to);
    }
  }
  return depth;
}

export interface Hub {
  id: string;
  url: string;
  outLinks: number;
}

/** Content pages with at least `minOutLinks` internal links. */
export function identifyHubs(graph: Graph, minOutLinks = 5): Hub[] {
  const hubs: Hub[] = [];
  for (const node of graph.nodesArray()) {
    if (!isContentKind(node)) continue;
    const outbound = graph.outEdges(node.id).filter((edge) => {
      if (!isLinksToEdge(edge.type)) return false;
      const target = graph.getNode(edge.to);
      return target !== undefined && isContentKind(target);
    });
    if (outbound.length >= minOutLinks) {
      hubs.push({
        id: node.id,
        url: typeof node.properties.url === 'string' ? node.properties.url : node.externalId,
        outLinks: outbound.length,
      });
    }
  }
  return hubs.sort((a, b) => b.outLinks - a.outLinks || a.id.localeCompare(b.id));
}

export interface AuthorityFlowOptions {
  /** Random-surf damping factor (PageRank). */
  damping?: number;
  /** Fixed iteration count keeps results deterministic. */
  iterations?: number;
}

/**
 * Weighted authority flow estimation over internal links. Deterministic:
 * fixed iteration count, edge weight as transition mass, dangling nodes
 * redistribute to the whole graph.
 */
export function estimateAuthorityFlow(graph: Graph, options: AuthorityFlowOptions = {}): Map<string, number> {
  const { damping = 0.85, iterations = 20 } = options;
  const nodes = graph.nodesArray().filter((node) => isContentKind(node));
  const count = nodes.length;
  const scores = new Map<string, number>();
  if (count === 0) return scores;
  const initial = 1 / count;
  for (const node of nodes) scores.set(node.id, initial);

  const outWeight = new Map<string, number>();
  for (const node of nodes) {
    const total = graph
      .outEdges(node.id)
      .filter((edge) => isLinksToEdge(edge.type))
      .reduce((sum, edge) => sum + edge.weight, 0);
    outWeight.set(node.id, total);
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Map<string, number>();
    const danglingMass = nodes.reduce((sum, node) => {
      const weight = outWeight.get(node.id) ?? 0;
      return sum + (weight === 0 ? (scores.get(node.id) ?? 0) : 0);
    }, 0);
    const base = (1 - damping + damping * danglingMass) / count;
    for (const node of nodes) next.set(node.id, base);
    for (const node of nodes) {
      const weight = outWeight.get(node.id) ?? 0;
      if (weight === 0) continue;
      const mass = damping * ((scores.get(node.id) ?? 0) / weight);
      for (const edge of graph.outEdges(node.id)) {
        if (!isLinksToEdge(edge.type)) continue;
        if (!scores.has(edge.to)) continue;
        next.set(edge.to, (next.get(edge.to) ?? base) + mass * edge.weight);
      }
    }
    for (const node of nodes) scores.set(node.id, next.get(node.id) ?? 0);
  }

  const total = nodes.reduce((sum, node) => sum + (scores.get(node.id) ?? 0), 0);
  if (total > 0) {
    for (const node of nodes) scores.set(node.id, (scores.get(node.id) ?? 0) / total);
  }
  return scores;
}

export interface TopicCluster {
  id: string;
  name: string;
  pageIds: string[];
  /** Shared entity names that define the cluster. */
  entities: string[];
}

/**
 * Discovers topic clusters: pages unioned when they share at least
 * `minSharedEntities` entities or are mutually linked.
 */
export function discoverTopicClusters(graph: Graph, minSharedEntities = 1): TopicCluster[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
    let current = id;
    while (current !== root) {
      const next = parent.get(current) ?? current;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const pages = graph.nodesArray().filter((node) => isContentKind(node));
  for (const page of pages) parent.set(page.id, page.id);

  const pageEntities = new Map<string, Set<string>>();
  for (const page of pages) {
    const entities = new Set<string>();
    for (const edge of graph.outEdges(page.id)) {
      if (edge.type !== 'contains') continue;
      const target = graph.getNode(edge.to);
      if (target === undefined || target.type !== 'entity') continue;
      const label = typeof target.properties.name === 'string' ? target.properties.name : target.externalId;
      entities.add(label);
    }
    pageEntities.set(page.id, entities);
  }

  const pageIds = pages.map((page) => page.id);
  for (let i = 0; i < pageIds.length; i += 1) {
    const a = pageIds[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < pageIds.length; j += 1) {
      const b = pageIds[j];
      if (b === undefined) continue;
      const shared = [...(pageEntities.get(a) ?? new Set<string>())].filter((entity) => pageEntities.get(b)?.has(entity));
      if (shared.length >= minSharedEntities) {
        union(a, b);
        continue;
      }
      if (graph.hasEdge('links_to', a, b) && graph.hasEdge('links_to', b, a)) union(a, b);
    }
  }

  const groups = new Map<string, string[]>();
  for (const page of pages) {
    const root = find(page.id);
    const group = groups.get(root) ?? [];
    group.push(page.id);
    groups.set(root, group);
  }
  const clusters: TopicCluster[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = group.sort();
    const entities = new Set<string>();
    for (const id of sorted) {
      for (const entity of pageEntities.get(id) ?? []) entities.add(entity);
    }
    const dominant = [...entities].sort((a, b) => {
      const aCount = sorted.filter((id) => pageEntities.get(id)?.has(a)).length;
      const bCount = sorted.filter((id) => pageEntities.get(id)?.has(b)).length;
      return bCount - aCount || a.localeCompare(b);
    })[0];
    clusters.push({
      id: `cluster-${sorted[0]}`,
      name: dominant ?? 'Untitled cluster',
      pageIds: sorted,
      entities: [...entities].sort(),
    });
  }
  return clusters.sort((a, b) => a.id.localeCompare(b.id));
}

export interface DuplicateTarget {
  keywordId: string;
  keyword: string;
  /** Content nodes targeting the same keyword. */
  sources: Array<{ id: string; url: string; type: NodeType }>;
}

/** Content nodes competing for the same keyword. */
export function findDuplicateTargets(graph: Graph): DuplicateTarget[] {
  const byKeyword = new Map<string, Array<{ id: string; url: string; type: NodeType }>>();
  for (const edge of graph.edgesArray()) {
    if (edge.type !== 'targets') continue;
    const source = graph.getNode(edge.from);
    const keyword = graph.getNode(edge.to);
    if (source === undefined || keyword === undefined || keyword.type !== 'keyword') continue;
    const url = typeof source.properties.url === 'string' ? source.properties.url : source.externalId;
    const entry = byKeyword.get(edge.to) ?? [];
    entry.push({ id: source.id, url, type: source.type });
    byKeyword.set(edge.to, entry);
  }
  const duplicates: DuplicateTarget[] = [];
  for (const [keywordId, sources] of byKeyword) {
    if (sources.length < 2) continue;
    const keywordNode = graph.getNode(keywordId);
    duplicates.push({
      keywordId,
      keyword: typeof keywordNode?.properties.keyword === 'string' ? keywordNode.properties.keyword : keywordId,
      sources: sources.sort((a, b) => a.id.localeCompare(b.id)),
    });
  }
  return duplicates.sort((a, b) => a.keywordId.localeCompare(b.keywordId));
}

export interface RecommendationDependency {
  recommendationId: string;
  title: string;
  fixes: string[];
  affects: string[];
  derivedFrom: string | null;
  /** Other recommendations that fix a shared issue. */
  coOccurring: string[];
}

/**
 * Maps recommendations to the issues they fix, the pages they affect, the
 * crawl they derive from, and co-occurring recommendations — the dependency
 * structure agents use to sequence work.
 */
export function recommendationDependencyGraph(graph: Graph): RecommendationDependency[] {
  const issuesByRecommendation = new Map<string, string[]>();
  const pagesByRecommendation = new Map<string, string[]>();
  const recommendationsByIssue = new Map<string, string[]>();
  const derivedFrom = new Map<string, string | null>();

  for (const edge of graph.edgesArray()) {
    const source = graph.getNode(edge.from);
    if (source === undefined || source.type !== 'seo-recommendation') continue;
    if (edge.type === 'fixes') {
      const fixes = issuesByRecommendation.get(edge.from) ?? [];
      fixes.push(edge.to);
      issuesByRecommendation.set(edge.from, fixes);
      const recs = recommendationsByIssue.get(edge.to) ?? [];
      recs.push(edge.from);
      recommendationsByIssue.set(edge.to, recs);
    } else if (edge.type === 'affects') {
      const affects = pagesByRecommendation.get(edge.from) ?? [];
      affects.push(edge.to);
      pagesByRecommendation.set(edge.from, affects);
    } else if (edge.type === 'derived_from' || edge.type === 'occurs_in') {
      derivedFrom.set(edge.from, edge.to);
    }
  }

  const dependencies: RecommendationDependency[] = [];
  for (const node of graph.nodesArray()) {
    if (node.type !== 'seo-recommendation') continue;
    const fixes = [...(issuesByRecommendation.get(node.id) ?? [])].sort();
    const coOccurring = new Set<string>();
    for (const issue of fixes) {
      for (const other of recommendationsByIssue.get(issue) ?? []) {
        if (other !== node.id) coOccurring.add(other);
      }
    }
    dependencies.push({
      recommendationId: node.externalId,
      title: node.name ?? node.externalId,
      fixes,
      affects: [...(pagesByRecommendation.get(node.id) ?? [])].sort(),
      derivedFrom: derivedFrom.get(node.id) ?? null,
      coOccurring: [...coOccurring].sort(),
    });
  }
  return dependencies.sort((a, b) => a.recommendationId.localeCompare(b.recommendationId));
}

/** Convenience: lists all node ids grouped by type, sorted deterministically. */
export function nodesByType(graph: Graph): Record<NodeType, string[]> {
  const grouped: Record<NodeType, string[]> = {} as Record<NodeType, string[]>;
  for (const type of NODE_TYPES) grouped[type] = [];
  for (const node of graph.nodesArray()) grouped[node.type].push(node.id);
  for (const type of NODE_TYPES) grouped[type].sort();
  return grouped;
}

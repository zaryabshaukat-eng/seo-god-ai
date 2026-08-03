import { assertAllowedPair, nodeTypeDefinition } from '../relationships/registry.js';
import type { EdgeInput, EdgeType, GraphEdgeData, GraphNodeData, NodeInput, NodeType } from '../types/graph.js';
import { edgeId, newId, nodeId as deriveNodeId } from '../utils/ids.js';
import { validateEdgeInput, validateNodeInput } from '../utils/validation.js';

const EDGE_KEY_SEPARATOR = '\u0000';

function edgeKey(type: EdgeType, from: string, to: string): string {
  return `${type}${EDGE_KEY_SEPARATOR}${from}${EDGE_KEY_SEPARATOR}${to}`;
}

export interface GraphOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

/**
 * In-memory directed multigraph with deterministic identity. `addNode` and
 * `addEdge` are idempotent: re-adding an existing node/edge updates it in
 * place instead of duplicating, which is what makes repeated builds converge
 * to the same graph.
 */
export class Graph {
  private readonly nodes = new Map<string, GraphNodeData>();
  private readonly edges = new Map<string, GraphEdgeData>();
  private readonly outAdjacency = new Map<string, Set<string>>();
  private readonly inAdjacency = new Map<string, Set<string>>();
  private readonly now: () => Date;

  constructor(options: GraphOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /** Idempotent node upsert keyed on its deterministic id. */
  addNode(input: NodeInput): GraphNodeData {
    validateNodeInput(input);
    const id = input.id ?? deriveNodeId(input.type, input.externalId);
    const timestamp = this.now();
    const existing = this.nodes.get(id);
    const node: GraphNodeData = {
      id,
      type: input.type,
      externalId: input.externalId,
      name: input.name ?? null,
      properties: input.properties ?? {},
      source: input.source,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? input.createdAt ?? timestamp,
      updatedAt: existing?.updatedAt ?? input.updatedAt ?? timestamp,
    };
    if (existing === undefined) {
      this.nodes.set(id, node);
      this.outAdjacency.set(id, new Set());
      this.inAdjacency.set(id, new Set());
    } else {
      this.nodes.set(id, node);
    }
    return node;
  }

  /** Finds a node by its business key, if it exists. */
  findNode(type: NodeType, externalId: string): GraphNodeData | undefined {
    return this.nodes.get(deriveNodeId(type, externalId));
  }

  /** Idempotent edge upsert keyed on (type, from, to). */
  addEdge(input: EdgeInput): GraphEdgeData {
    validateEdgeInput(input);
    const sourceNode = this.nodes.get(input.from);
    const targetNode = this.nodes.get(input.to);
    if (sourceNode === undefined || targetNode === undefined) {
      throw new Error(`Cannot add edge "${input.type}": node does not exist in the graph`);
    }
    assertAllowedPair(input.type, sourceNode.type, targetNode.type);
    const id = input.id ?? edgeId(input.type, input.from, input.to);
    const timestamp = input.createdAt ?? this.now();
    const existing = this.edges.get(edgeKey(input.type, input.from, input.to));
    const edge: GraphEdgeData = {
      id,
      type: input.type,
      from: input.from,
      to: input.to,
      weight: input.weight ?? existing?.weight ?? 1,
      confidence: input.confidence ?? existing?.confidence ?? 1,
      source: input.source,
      properties: input.properties ?? existing?.properties ?? {},
      createdAt: existing?.createdAt ?? timestamp,
    };
    this.edges.set(edgeKey(input.type, input.from, input.to), edge);
    this.outAdjacency.get(input.from)?.add(edgeKey(input.type, input.from, input.to));
    this.inAdjacency.get(input.to)?.add(edgeKey(input.type, input.from, input.to));
    return edge;
  }

  getNode(id: string): GraphNodeData | undefined {
    return this.nodes.get(id);
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  hasEdge(type: EdgeType, from: string, to: string): boolean {
    return this.edges.has(edgeKey(type, from, to));
  }

  getEdge(type: EdgeType, from: string, to: string): GraphEdgeData | undefined {
    return this.edges.get(edgeKey(type, from, to));
  }

  getEdgeById(id: string): GraphEdgeData | undefined {
    for (const edge of this.edges.values()) {
      if (edge.id === id) return edge;
    }
    return undefined;
  }

  /** Removes an edge, returning true when one was removed. */
  removeEdge(type: EdgeType, from: string, to: string): boolean {
    const key = edgeKey(type, from, to);
    if (!this.edges.delete(key)) return false;
    this.outAdjacency.get(from)?.delete(key);
    this.inAdjacency.get(to)?.delete(key);
    return true;
  }

  /** Removes a node and all incident edges, returning true when one was removed. */
  removeNode(id: string): boolean {
    const node = this.nodes.get(id);
    if (node === undefined) return false;
    for (const key of [...(this.outAdjacency.get(id) ?? [])]) {
      this.removeEdgeByKey(key);
    }
    for (const key of [...(this.inAdjacency.get(id) ?? [])]) {
      this.removeEdgeByKey(key);
    }
    this.nodes.delete(id);
    this.outAdjacency.delete(id);
    this.inAdjacency.delete(id);
    return true;
  }

  private removeEdgeByKey(key: string): void {
    const edge = this.edges.get(key);
    /* v8 ignore next 1 -- defensive: adjacency keys are kept in sync with edges */
    if (edge === undefined) return;
    this.edges.delete(key);
    this.outAdjacency.get(edge.from)?.delete(key);
    this.inAdjacency.get(edge.to)?.delete(key);
  }

  outEdges(nodeId: string): GraphEdgeData[] {
    const keys = this.outAdjacency.get(nodeId);
    if (keys === undefined) return [];
    const result: GraphEdgeData[] = [];
    for (const key of keys) {
      const edge = this.edges.get(key);
      if (edge !== undefined) result.push(edge);
    }
    return result;
  }

  inEdges(nodeId: string): GraphEdgeData[] {
    const keys = this.inAdjacency.get(nodeId);
    if (keys === undefined) return [];
    const result: GraphEdgeData[] = [];
    for (const key of keys) {
      const edge = this.edges.get(key);
      if (edge !== undefined) result.push(edge);
    }
    return result;
  }

  outNeighbors(nodeId: string): string[] {
    return this.outEdges(nodeId).map((edge) => edge.to);
  }

  inNeighbors(nodeId: string): string[] {
    return this.inEdges(nodeId).map((edge) => edge.from);
  }

  get nodesSize(): number {
    return this.nodes.size;
  }

  get edgesSize(): number {
    return this.edges.size;
  }

  nodesIterator(): IterableIterator<GraphNodeData> {
    return this.nodes.values();
  }

  nodesArray(): GraphNodeData[] {
    return [...this.nodes.values()];
  }

  edgesArray(): GraphEdgeData[] {
    return [...this.edges.values()];
  }

  /** Merges another graph's nodes and edges into this one. */
  merge(other: Graph): void {
    for (const node of other.nodesArray()) {
      this.addNode({
        type: node.type,
        externalId: node.externalId,
        name: node.name,
        properties: node.properties,
        source: node.source,
        id: node.id,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      });
    }
    for (const edge of other.edgesArray()) {
      this.addEdge({
        type: edge.type,
        from: edge.from,
        to: edge.to,
        weight: edge.weight,
        confidence: edge.confidence,
        source: edge.source,
        properties: edge.properties,
        id: edge.id,
        createdAt: edge.createdAt,
      });
    }
  }

  /** Returns the induced subgraph over the given node ids. */
  subgraph(nodeIds: string[]): Graph {
    const keep = new Set(nodeIds);
    const graph = new Graph({ now: this.now });
    for (const id of keep) {
      const node = this.nodes.get(id);
      if (node !== undefined) {
        graph.addNode({
          type: node.type,
          externalId: node.externalId,
          name: node.name,
          properties: node.properties,
          source: node.source,
          id: node.id,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
        });
      }
    }
    for (const edge of this.edgesArray()) {
      if (keep.has(edge.from) && keep.has(edge.to)) {
        graph.addEdge({
          type: edge.type,
          from: edge.from,
          to: edge.to,
          weight: edge.weight,
          confidence: edge.confidence,
          source: edge.source,
          properties: edge.properties,
          id: edge.id,
          createdAt: edge.createdAt,
        });
      }
    }
    return graph;
  }

  /** Clones the graph (used to compute diffs against a changed copy). */
  clone(): Graph {
    const graph = new Graph({ now: this.now });
    graph.merge(this);
    return graph;
  }

  /** Builds a Graph from persisted node/edge records. */
  static fromRecords(nodes: GraphNodeData[], edges: GraphEdgeData[], options: GraphOptions = {}): Graph {
    const graph = new Graph(options);
    for (const node of nodes) {
      graph.addNode({
        type: node.type,
        externalId: node.externalId,
        name: node.name,
        properties: node.properties,
        source: node.source,
        id: node.id,
        version: node.version,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      });
    }
    for (const edge of edges) {
      graph.addEdge({
        type: edge.type,
        from: edge.from,
        to: edge.to,
        weight: edge.weight,
        confidence: edge.confidence,
        source: edge.source,
        properties: edge.properties,
        id: edge.id,
        createdAt: edge.createdAt,
      });
    }
    return graph;
  }

  /** Returns a fresh node id (used for nodes without a natural business key). */
  static newId(): string {
    return newId();
  }

  /** Node label helper for explainability. */
  static nodeLabel(node: GraphNodeData): string {
    return node.name ?? nodeTypeDefinition(node.type).label;
  }
}

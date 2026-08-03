import { newId } from '../utils/ids.js';
import type { GraphSnapshotRecord } from '../types/snapshot.js';
import type { Graph } from './graph.js';

export interface GraphSnapshotOptions {
  id?: string;
  label?: string | null;
  previousSnapshotId?: string | null;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

/**
 * A versioned graph for one store. One snapshot is created per crawl; each
 * snapshot records its provenance (source) and link to the previous version.
 */
export class GraphSnapshot {
  readonly id: string;
  readonly storeId: string;
  readonly version: number;
  readonly label: string | null;
  readonly source: string;
  readonly previousSnapshotId: string | null;
  readonly graph: Graph;
  readonly createdAt: Date;

  constructor(
    storeId: string,
    version: number,
    graph: Graph,
    source: string,
    options: GraphSnapshotOptions = {},
  ) {
    this.id = options.id ?? newId();
    this.storeId = storeId;
    this.version = version;
    this.label = options.label ?? null;
    this.source = source;
    this.previousSnapshotId = options.previousSnapshotId ?? null;
    this.graph = graph;
    this.createdAt = (options.now ?? (() => new Date()))();
  }

  /** Node count helper for summaries. */
  get nodeCount(): number {
    return this.graph.nodesSize;
  }

  /** Edge count helper for summaries. */
  get edgeCount(): number {
    return this.graph.edgesSize;
  }

  /** Converts the snapshot into its persisted record shape. */
  toRecord(): GraphSnapshotRecord {
    const nodeTypes: Record<string, number> = {};
    const edgeTypes: Record<string, number> = {};
    for (const node of this.graph.nodesArray()) {
      nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
    }
    for (const edge of this.graph.edgesArray()) {
      edgeTypes[edge.type] = (edgeTypes[edge.type] ?? 0) + 1;
    }
    return {
      id: this.id,
      storeId: this.storeId,
      version: this.version,
      label: this.label,
      source: this.source,
      previousSnapshotId: this.previousSnapshotId,
      summary: {
        nodeCount: this.nodeCount,
        edgeCount: this.edgeCount,
        nodeTypes,
        edgeTypes,
        buildMs: 0,
      },
      nodes: this.graph.nodesArray(),
      edges: this.graph.edgesArray(),
      createdAt: this.createdAt,
    };
  }
}

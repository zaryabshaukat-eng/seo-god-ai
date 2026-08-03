import type { GraphEdgeData, GraphNodeData } from './graph.js';

/** A persisted version of the graph for one store. */
export interface GraphSnapshotRecord {
  id: string;
  storeId: string;
  version: number;
  label: string | null;
  source: string;
  previousSnapshotId: string | null;
  summary: {
    nodeCount: number;
    edgeCount: number;
    nodeTypes: Record<string, number>;
    edgeTypes: Record<string, number>;
    buildMs: number;
  };
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  createdAt: Date;
}

/** The result of comparing two snapshots. */
export interface SnapshotDiff {
  previousId: string;
  currentId: string;
  previousVersion: number;
  currentVersion: number;
  addedNodes: GraphNodeData[];
  removedNodes: GraphNodeData[];
  changedNodes: Array<{ node: GraphNodeData; changedFields: string[] }>;
  addedEdges: GraphEdgeData[];
  removedEdges: GraphEdgeData[];
  changedEdges: Array<{ edge: GraphEdgeData; changedFields: string[] }>;
}

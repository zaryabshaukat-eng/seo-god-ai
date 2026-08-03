import type { Graph } from '../models/graph.js';
import type { GraphEdgeData, GraphNodeData } from '../types/graph.js';
import type { SnapshotDiff } from '../types/snapshot.js';

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    const aList = a as unknown[];
    const bList = b as unknown[];
    if (aList.length !== bList.length) return false;
    return aList.every((item, index) => deepEqual(item, bList[index]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
}

function changedFieldsNode(previous: GraphNodeData, current: GraphNodeData): string[] {
  const fields: string[] = [];
  if (previous.name !== current.name) fields.push('name');
  if (previous.source !== current.source) fields.push('source');
  if (previous.version !== current.version) fields.push('version');
  if (!deepEqual(previous.properties, current.properties)) fields.push('properties');
  if (previous.updatedAt.getTime() !== current.updatedAt.getTime()) fields.push('updatedAt');
  return fields;
}

function changedFieldsEdge(previous: GraphEdgeData, current: GraphEdgeData): string[] {
  const fields: string[] = [];
  if (previous.weight !== current.weight) fields.push('weight');
  if (previous.confidence !== current.confidence) fields.push('confidence');
  if (previous.source !== current.source) fields.push('source');
  if (!deepEqual(previous.properties, current.properties)) fields.push('properties');
  return fields;
}

export interface DiffContext {
  previousId: string;
  currentId: string;
  previousVersion: number;
  currentVersion: number;
}

/** Computes the structural difference between two graph versions. */
export function diffGraphs(previous: Graph, current: Graph, context: DiffContext): SnapshotDiff {
  const previousNodes = new Map(previous.nodesArray().map((node) => [node.id, node]));
  const currentNodes = new Map(current.nodesArray().map((node) => [node.id, node]));

  const addedNodes: GraphNodeData[] = [];
  const removedNodes: GraphNodeData[] = [];
  const changedNodes: SnapshotDiff['changedNodes'] = [];
  for (const [id, node] of currentNodes) {
    const old = previousNodes.get(id);
    if (old === undefined) {
      addedNodes.push(node);
    } else {
      const changedFields = changedFieldsNode(old, node);
      if (changedFields.length > 0) changedNodes.push({ node, changedFields });
    }
  }
  for (const [id, node] of previousNodes) {
    if (!currentNodes.has(id)) removedNodes.push(node);
  }

  const previousEdges = new Map(previous.edgesArray().map((edge) => [edge.id, edge]));
  const currentEdges = new Map(current.edgesArray().map((edge) => [edge.id, edge]));

  const addedEdges: GraphEdgeData[] = [];
  const removedEdges: GraphEdgeData[] = [];
  const changedEdges: SnapshotDiff['changedEdges'] = [];
  for (const [id, edge] of currentEdges) {
    const old = previousEdges.get(id);
    if (old === undefined) {
      addedEdges.push(edge);
    } else {
      const changedFields = changedFieldsEdge(old, edge);
      if (changedFields.length > 0) changedEdges.push({ edge, changedFields });
    }
  }
  for (const [id, edge] of previousEdges) {
    if (!currentEdges.has(id)) removedEdges.push(edge);
  }

  const sortNodes = (nodes: GraphNodeData[]): GraphNodeData[] =>
    nodes.sort((a, b) => a.id.localeCompare(b.id));
  const sortEdges = (edges: GraphEdgeData[]): GraphEdgeData[] =>
    edges.sort((a, b) => a.id.localeCompare(b.id));

  return {
    previousId: context.previousId,
    currentId: context.currentId,
    previousVersion: context.previousVersion,
    currentVersion: context.currentVersion,
    addedNodes: sortNodes(addedNodes),
    removedNodes: sortNodes(removedNodes),
    changedNodes: changedNodes.sort((a, b) => a.node.id.localeCompare(b.node.id)),
    addedEdges: sortEdges(addedEdges),
    removedEdges: sortEdges(removedEdges),
    changedEdges: changedEdges.sort((a, b) => a.edge.id.localeCompare(b.edge.id)),
  };
}

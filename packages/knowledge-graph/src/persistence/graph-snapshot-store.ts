import { Prisma, type PrismaClient } from '@prisma/client';
import type { GraphEdgeData, GraphNodeData } from '../types/graph.js';
import type { GraphSnapshotRecord } from '../types/snapshot.js';

/**
 * Storage contract for graph snapshots. The default implementation persists
 * to PostgreSQL via Prisma; an alternative store can be swapped in later
 * (e.g. Neo4j) without touching the service layer.
 */
export interface GraphSnapshotStore {
  create(record: GraphSnapshotRecord): Promise<GraphSnapshotRecord>;
  findById(id: string): Promise<GraphSnapshotRecord | null>;
  latestForStore(storeId: string): Promise<GraphSnapshotRecord | null>;
  nextVersion(storeId: string): Promise<number>;
  listForStore(storeId: string): Promise<GraphSnapshotRecord[]>;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) {
    return null;
  }
  return value as Prisma.InputJsonValue;
}

function toNodeRecord(row: {
  id: string;
  type: string;
  externalId: string;
  name: string | null;
  properties: unknown;
  source: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): GraphNodeData {
  return {
    id: row.id,
    type: row.type as GraphNodeData['type'],
    externalId: row.externalId,
    name: row.name,
    properties: (row.properties as Record<string, unknown> | null) ?? {},
    source: row.source,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toEdgeRecord(row: {
  id: string;
  type: string;
  sourceNodeId: string;
  targetNodeId: string;
  weight: number;
  confidence: number;
  source: string;
  properties: unknown;
  createdAt: Date;
}): GraphEdgeData {
  return {
    id: row.id,
    type: row.type as GraphEdgeData['type'],
    from: row.sourceNodeId,
    to: row.targetNodeId,
    weight: row.weight,
    confidence: row.confidence,
    source: row.source,
    properties: (row.properties as Record<string, unknown> | null) ?? {},
    createdAt: row.createdAt,
  };
}

/** PostgreSQL-backed {@link GraphSnapshotStore} using the Prisma client. */
export class PrismaGraphSnapshotStore implements GraphSnapshotStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(record: GraphSnapshotRecord): Promise<GraphSnapshotRecord> {
    await this.prisma.$transaction(async (tx) => {
      await tx.graphSnapshot.create({
        data: {
          id: record.id,
          storeId: record.storeId,
          version: record.version,
          label: record.label,
          source: record.source,
          previousSnapshotId: record.previousSnapshotId,
          summary: toPrismaJson(record.summary) ?? Prisma.JsonNull,
          createdAt: record.createdAt,
        },
      });
      await tx.graphNode.createMany({
        data: record.nodes.map((node) => ({
          id: node.id,
          snapshotId: record.id,
          storeId: record.storeId,
          type: node.type,
          externalId: node.externalId,
          name: node.name,
          properties: toPrismaJson(node.properties) ?? Prisma.JsonNull,
          source: node.source,
          version: node.version,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
        })),
      });
      await tx.graphEdge.createMany({
        data: record.edges.map((edge) => ({
          id: edge.id,
          snapshotId: record.id,
          storeId: record.storeId,
          type: edge.type,
          sourceNodeId: edge.from,
          targetNodeId: edge.to,
          weight: edge.weight,
          confidence: edge.confidence,
          source: edge.source,
          properties: toPrismaJson(edge.properties) ?? Prisma.JsonNull,
          createdAt: edge.createdAt,
        })),
      });
    });
    return record;
  }

  async findById(id: string): Promise<GraphSnapshotRecord | null> {
    const snapshot = await this.prisma.graphSnapshot.findUnique({ where: { id } });
    if (snapshot === null) return null;
    return this.assemble(snapshot);
  }

  async latestForStore(storeId: string): Promise<GraphSnapshotRecord | null> {
    const snapshot = await this.prisma.graphSnapshot.findFirst({
      where: { storeId },
      orderBy: { version: 'desc' },
    });
    if (snapshot === null) return null;
    return this.assemble(snapshot);
  }

  async nextVersion(storeId: string): Promise<number> {
    const latest = await this.prisma.graphSnapshot.findFirst({
      where: { storeId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (latest?.version ?? 0) + 1;
  }

  async listForStore(storeId: string): Promise<GraphSnapshotRecord[]> {
    const snapshots = await this.prisma.graphSnapshot.findMany({
      where: { storeId },
      orderBy: { version: 'asc' },
    });
    const records: GraphSnapshotRecord[] = [];
    for (const snapshot of snapshots) {
      records.push(await this.assemble(snapshot));
    }
    return records;
  }

  private async assemble(snapshot: {
    id: string;
    storeId: string;
    version: number;
    label: string | null;
    source: string;
    previousSnapshotId: string | null;
    summary: unknown;
    createdAt: Date;
  }): Promise<GraphSnapshotRecord> {
    const [nodes, edges] = await Promise.all([
      this.prisma.graphNode.findMany({ where: { snapshotId: snapshot.id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.graphEdge.findMany({ where: { snapshotId: snapshot.id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const nodeRows = nodes.map(toNodeRecord);
    const edgeRows = edges.map(toEdgeRecord);
    const storedSummary = snapshot.summary as GraphSnapshotRecord['summary'] | null;
    const nodeTypes: Record<string, number> = {};
    for (const node of nodeRows) nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
    const edgeTypes: Record<string, number> = {};
    for (const edge of edgeRows) edgeTypes[edge.type] = (edgeTypes[edge.type] ?? 0) + 1;
    return {
      id: snapshot.id,
      storeId: snapshot.storeId,
      version: snapshot.version,
      label: snapshot.label,
      source: snapshot.source,
      previousSnapshotId: snapshot.previousSnapshotId,
      summary:
        storedSummary ?? {
          nodeCount: nodeRows.length,
          edgeCount: edgeRows.length,
          nodeTypes,
          edgeTypes,
          buildMs: 0,
        },
      nodes: nodeRows,
      edges: edgeRows,
      createdAt: snapshot.createdAt,
    };
  }
}

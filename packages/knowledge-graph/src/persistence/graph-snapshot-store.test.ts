import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../test/fixtures.js';
import type { GraphEdgeData, GraphNodeData } from '../types/graph.js';
import type { GraphSnapshotRecord } from '../types/snapshot.js';
import { PrismaGraphSnapshotStore } from './graph-snapshot-store.js';

type Row = Record<string, unknown>;

function makeRecord(id: string, version: number): GraphSnapshotRecord {
  const nodeA: GraphNodeData = {
    id: `node-a-${version}`,
    type: 'page',
    externalId: `https://acme.example/p/${version}`,
    name: 'Page',
    properties: { url: `https://acme.example/p/${version}` },
    source: 'crawler',
    version: 1,
    createdAt: fixedClock(),
    updatedAt: fixedClock(),
  };
  const nodeB: GraphNodeData = {
    id: `node-b-${version}`,
    type: 'page',
    externalId: `https://acme.example/q/${version}`,
    name: null,
    properties: {},
    source: 'crawler',
    version: 1,
    createdAt: fixedClock(),
    updatedAt: fixedClock(),
  };
  const edge: GraphEdgeData = {
    id: `edge-ab-${version}`,
    type: 'links_to',
    from: nodeA.id,
    to: nodeB.id,
    weight: 1,
    confidence: 1,
    source: 'crawler',
    properties: {},
    createdAt: fixedClock(),
  };
  return {
    id,
    storeId: 'store-1',
    version,
    label: null,
    source: 'crawl.completed',
    previousSnapshotId: version === 1 ? null : `snap-${version - 1}`,
    summary: {
      nodeCount: 2,
      edgeCount: 1,
      nodeTypes: { page: 2 },
      edgeTypes: { links_to: 1 },
      buildMs: 5,
    },
    nodes: [nodeA, nodeB],
    edges: [edge],
    createdAt: fixedClock(),
  };
}

function mockPrisma() {
  const rows: { snapshots: Row[]; nodes: Row[]; edges: Row[] } = { snapshots: [], nodes: [], edges: [] };
  const prisma = {
    graphSnapshot: {
      create: vi.fn(async (args: { data: Row }) => {
        rows.snapshots.push(args.data);
        return args.data;
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) =>
        rows.snapshots.find((s) => s.id === args.where.id) ?? null,
      ),
      findFirst: vi.fn(async (args: { where: { storeId?: string }; orderBy: unknown; select?: unknown }) => {
        const list = [...rows.snapshots].sort((a, b) => (b.version as number) - (a.version as number));
        const match = list.find((s) => (args.where.storeId ?? s.storeId) === s.storeId);
        if (match === undefined) return null;
        return args.select === undefined ? match : { version: match.version };
      }),
      findMany: vi.fn(async (args: { where: { storeId: string } }) =>
        rows.snapshots
          .filter((s) => s.storeId === args.where.storeId)
          .sort((a, b) => (a.version as number) - (b.version as number)),
      ),
    },
    graphNode: {
      createMany: vi.fn(async (args: { data: Row[] }) => {
        rows.nodes.push(...args.data);
        return { count: args.data.length };
      }),
      findMany: vi.fn(async (args: { where: { snapshotId: string } }) =>
        rows.nodes.filter((n) => n.snapshotId === args.where.snapshotId),
      ),
    },
    graphEdge: {
      createMany: vi.fn(async (args: { data: Row[] }) => {
        rows.edges.push(...args.data);
        return { count: args.data.length };
      }),
      findMany: vi.fn(async (args: { where: { snapshotId: string } }) =>
        rows.edges.filter((e) => e.snapshotId === args.where.snapshotId),
      ),
    },
    $transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
  return { prisma, rows };
}

describe('PrismaGraphSnapshotStore', () => {
  it('persists and reassembles a snapshot round-trip', async () => {
    const { prisma } = mockPrisma();
    const store = new PrismaGraphSnapshotStore(prisma as unknown as PrismaClient);
    const record = makeRecord('snap-1', 1);
    await store.create(record);
    expect(prisma.graphSnapshot.create).toHaveBeenCalledTimes(1);
    expect(prisma.graphNode.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.graphEdge.createMany).toHaveBeenCalledTimes(1);

    const loaded = await store.findById('snap-1');
    expect(loaded).toEqual(record);
    expect(loaded?.summary.nodeCount).toBe(2);
  });

  it('returns null for missing snapshots', async () => {
    const { prisma } = mockPrisma();
    const store = new PrismaGraphSnapshotStore(prisma as unknown as PrismaClient);
    expect(await store.findById('missing')).toBeNull();
  });

  it('returns the latest snapshot per store', async () => {
    const { prisma } = mockPrisma();
    const store = new PrismaGraphSnapshotStore(prisma as unknown as PrismaClient);
    await store.create(makeRecord('snap-1', 1));
    await store.create(makeRecord('snap-2', 2));
    const latest = await store.latestForStore('store-1');
    expect(latest?.id).toBe('snap-2');
    expect(latest?.version).toBe(2);
    expect(await store.latestForStore('other-store')).toBeNull();
  });

  it('computes the next version', async () => {
    const { prisma } = mockPrisma();
    const store = new PrismaGraphSnapshotStore(prisma as unknown as PrismaClient);
    expect(await store.nextVersion('store-1')).toBe(1);
    await store.create(makeRecord('snap-1', 1));
    expect(await store.nextVersion('store-1')).toBe(2);
  });

  it('lists snapshots for a store in version order', async () => {
    const { prisma } = mockPrisma();
    const store = new PrismaGraphSnapshotStore(prisma as unknown as PrismaClient);
    await store.create(makeRecord('snap-1', 1));
    await store.create(makeRecord('snap-2', 2));
    const list = await store.listForStore('store-1');
    expect(list.map((r) => r.version)).toEqual([1, 2]);
  });

  it('reconstructs the summary when the stored summary is null', async () => {
    const { prisma, rows } = mockPrisma();
    const store = new PrismaGraphSnapshotStore(prisma as unknown as PrismaClient);
    const record = makeRecord('snap-1', 1);
    await store.create(record);
    rows.snapshots[0]!.summary = null;
    const loaded = await store.findById('snap-1');
    expect(loaded?.summary.nodeCount).toBe(2);
    expect(loaded?.summary.nodeTypes).toEqual({ page: 2 });
  });

  it('stores null json for empty properties and summary, and restores null properties', async () => {
    const { prisma, rows } = mockPrisma();
    const store = new PrismaGraphSnapshotStore(prisma as unknown as PrismaClient);
    const record = makeRecord('snap-1', 1);
    record.summary = null as never;
    record.nodes[0]!.properties = {} as never;
    record.edges[0]!.properties = null as never;
    await store.create(record);
    expect(prisma.graphSnapshot.create).toHaveBeenCalledTimes(1);
    rows.snapshots[0]!.summary = {
      nodeCount: 2,
      edgeCount: 1,
      nodeTypes: { page: 2 },
      edgeTypes: { links_to: 1 },
      buildMs: 0,
    };
    rows.nodes[0]!.properties = null;
    rows.edges[0]!.properties = null;
    const loaded = await store.findById('snap-1');
    expect(loaded?.nodes[0]!.properties).toEqual({});
    expect(loaded?.edges[0]!.properties).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import { nodeId } from '../utils/ids.js';
import { Graph } from './graph.js';

const fixed = () => new Date('2026-01-01T00:00:00.000Z');
const page1 = () => ({
  type: 'page' as const,
  externalId: 'https://acme.example/p/1',
  name: 'Page one',
  properties: { url: 'https://acme.example/p/1' },
  source: 'crawler',
});
const page2 = () => ({
  type: 'page' as const,
  externalId: 'https://acme.example/p/2',
  name: 'Page two',
  properties: { url: 'https://acme.example/p/2' },
  source: 'crawler',
});
const product1 = () => ({
  type: 'product' as const,
  externalId: 'https://acme.example/products/1',
  name: 'Product one',
  properties: { url: 'https://acme.example/products/1' },
  source: 'crawler',
});
const keyword = () => ({
  type: 'keyword' as const,
  externalId: 'acme-widget',
  name: 'acme widget',
  properties: {},
  source: 'builder',
});

describe('Graph', () => {
  it('adds nodes idempotently with deterministic ids and versioning', () => {
    const graph = new Graph({ now: fixed });
    const a = graph.addNode(page1());
    const again = graph.addNode(page1());
    expect(again.id).toBe(a.id);
    expect(again.version).toBe(2);
    expect(graph.nodesSize).toBe(1);
    expect(graph.getNode(a.id)?.createdAt).toEqual(fixed());
    expect(graph.findNode('page', 'https://acme.example/p/1')?.id).toBe(a.id);
  });

  it('adds edges idempotently and preserves the first createdAt', () => {
    const graph = new Graph({ now: fixed });
    const a = graph.addNode(page1());
    const b = graph.addNode(page2());
    const edge = graph.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });
    const again = graph.addEdge({
      type: 'links_to',
      from: a.id,
      to: b.id,
      source: 'crawler',
      weight: 0.9,
      confidence: 0.8,
    });
    expect(again.id).toBe(edge.id);
    expect(graph.edgesSize).toBe(1);
    expect(again.weight).toBe(0.9);
    expect(again.confidence).toBe(0.8);
    expect(again.createdAt).toEqual(fixed());
    expect(graph.hasEdge('links_to', a.id, b.id)).toBe(true);
    expect(graph.getEdgeById(edge.id)?.type).toBe('links_to');
  });

  it('rejects edges between invalid node type pairs', () => {
    const graph = new Graph();
    const product = graph.addNode(product1());
    const word = graph.addNode(keyword());
    expect(() =>
      graph.addEdge({ type: 'targets', from: word.id, to: product.id, source: 'builder' }),
    ).toThrow(/targets/);
    expect(() =>
      graph.addEdge({ type: 'links_to', from: product.id, to: word.id, source: 'crawler' }),
    ).toThrow(/links_to/);
  });

  it('rejects edges to missing nodes and self-loops', () => {
    const graph = new Graph();
    const a = graph.addNode(page1());
    expect(() =>
      graph.addEdge({ type: 'links_to', from: a.id, to: 'missing', source: 'crawler' }),
    ).toThrow(/does not exist/);
    expect(() => graph.addEdge({ type: 'links_to', from: a.id, to: a.id, source: 'crawler' })).toThrow(
      /Self-referencing/,
    );
  });

  it('tracks in/out adjacency', () => {
    const graph = new Graph();
    const a = graph.addNode(page1());
    const b = graph.addNode(page2());
    graph.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });
    expect(graph.outEdges(a.id).map((e) => e.to)).toEqual([b.id]);
    expect(graph.inEdges(b.id).map((e) => e.from)).toEqual([a.id]);
    expect(graph.outNeighbors(a.id)).toEqual([b.id]);
    expect(graph.inNeighbors(b.id)).toEqual([a.id]);
  });

  it('removes edges and nodes with incident edges', () => {
    const graph = new Graph();
    const a = graph.addNode(page1());
    const b = graph.addNode(page2());
    graph.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });
    graph.addEdge({ type: 'links_to', from: b.id, to: a.id, source: 'crawler' });
    expect(graph.removeEdge('links_to', a.id, b.id)).toBe(true);
    expect(graph.removeEdge('links_to', a.id, b.id)).toBe(false);
    expect(graph.removeNode(a.id)).toBe(true);
    expect(graph.hasNode(a.id)).toBe(false);
    expect(graph.nodesSize).toBe(1);
    expect(graph.removeNode(a.id)).toBe(false);
  });

  it('merges graphs and builds subgraphs', () => {
    const first = new Graph();
    const a = first.addNode(page1());
    const b = first.addNode(page2());
    first.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });

    const second = new Graph();
    const c = second.addNode(product1());
    const d = second.addNode(keyword());
    second.addEdge({ type: 'targets', from: c.id, to: d.id, source: 'builder' });

    const merged = new Graph();
    merged.merge(first);
    merged.merge(second);
    expect(merged.nodesSize).toBe(4);
    expect(merged.edgesSize).toBe(2);

    const sub = merged.subgraph([a.id, b.id]);
    expect(sub.nodesSize).toBe(2);
    expect(sub.edgesSize).toBe(1);
    expect(sub.getNode(c.id)).toBeUndefined();
  });

  it('clones graphs and reconstructs from records', () => {
    const graph = new Graph();
    const a = graph.addNode(page1());
    const b = graph.addNode(page2());
    graph.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });

    const clone = graph.clone();
    expect(clone.nodesSize).toBe(2);
    expect(clone.edgesSize).toBe(1);

    const rebuilt = Graph.fromRecords(graph.nodesArray(), graph.edgesArray(), { now: fixed });
    expect(rebuilt.nodesSize).toBe(2);
    expect(rebuilt.edgesSize).toBe(1);
    expect(rebuilt.getEdge('links_to', a.id, b.id)?.from).toBe(a.id);
  });

  it('labels nodes for explainability', () => {
    const graph = new Graph();
    const a = graph.addNode(page1());
    const unnamed = graph.addNode({ ...page1(), externalId: 'https://acme.example/x', name: null });
    expect(Graph.nodeLabel(a)).toBe('Page one');
    expect(Graph.nodeLabel(unnamed)).toBe('Page');
    expect(Graph.newId()).toMatch(/[0-9a-f-]{36}/);
  });

  it('creates deterministic node ids via helper', () => {
    expect(nodeId('page', 'https://acme.example/p/1')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('preserves existing weight and confidence on re-add without them', () => {
    const graph = new Graph({ now: fixed });
    const a = graph.addNode(page1());
    const b = graph.addNode(page2());
    graph.addEdge({ type: 'links_to', from: a.id, to: b.id, weight: 0.5, confidence: 0.7, source: 'crawler' });
    const reAdd = graph.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });
    expect(reAdd.weight).toBe(0.5);
    expect(reAdd.confidence).toBe(0.7);
  });

  it('returns undefined for missing edge ids and empty adjacency lookups', () => {
    const graph = new Graph({ now: fixed });
    const a = graph.addNode(page1());
    const b = graph.addNode(page2());
    graph.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });
    expect(graph.getEdgeById('missing-edge')).toBeUndefined();
    expect(graph.outEdges('missing-node')).toEqual([]);
    expect(graph.inEdges('missing-node')).toEqual([]);
  });

  it('removes isolated nodes with no incident edges', () => {
    const graph = new Graph({ now: fixed });
    const a = graph.addNode(page1());
    const b = graph.addNode(page2());
    graph.removeNode(a.id);
    expect(graph.hasNode(a.id)).toBe(false);
    expect(graph.hasNode(b.id)).toBe(true);
    expect([...graph.nodesIterator()].map((n) => n.id)).toContain(b.id);
  });
});

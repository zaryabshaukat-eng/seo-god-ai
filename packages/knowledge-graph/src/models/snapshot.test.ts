import { describe, expect, it } from 'vitest';
import { GraphSnapshot } from './snapshot.js';
import { Graph } from './graph.js';

describe('GraphSnapshot', () => {
  it('falls back to a live clock when no clock is provided', () => {
    const graph = new Graph();
    graph.addNode({ type: 'page', externalId: 'https://acme.example/p/1', source: 'crawler' });
    const snapshot = new GraphSnapshot('store-1', 1, graph, 'crawl.completed');
    expect(snapshot.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(snapshot.nodeCount).toBe(1);
    expect(snapshot.edgeCount).toBe(0);
    expect(snapshot.createdAt.getTime()).toBeGreaterThan(0);
  });
});

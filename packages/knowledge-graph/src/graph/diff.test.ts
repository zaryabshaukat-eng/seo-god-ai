import { describe, expect, it } from 'vitest';
import { diffGraphs } from './diff.js';
import { Graph } from '../models/graph.js';
import { fixedClock } from '../test/fixtures.js';

function node(overrides: Partial<Parameters<Graph['addNode']>[0]> = {}) {
  return {
    type: 'page' as const,
    externalId: 'https://acme.example/p/1',
    source: 'crawler',
    ...overrides,
  };
}

describe('diffGraphs', () => {
  it('detects added, removed, and changed nodes and edges', () => {
    const previous = new Graph({ now: fixedClock });
    const a = previous.addNode(node());
    const b = previous.addNode(node({ externalId: 'https://acme.example/p/2' }));
    previous.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });

    const current = new Graph({ now: fixedClock });
    const a2 = current.addNode(node({ name: 'Renamed' }));
    const c = current.addNode(node({ externalId: 'https://acme.example/p/3' }));
    current.addEdge({ type: 'links_to', from: a2.id, to: c.id, source: 'crawler' });

    const diff = diffGraphs(previous, current, {
      previousId: 'prev',
      currentId: 'curr',
      previousVersion: 1,
      currentVersion: 2,
    });

    expect(diff.previousId).toBe('prev');
    expect(diff.currentVersion).toBe(2);
    expect(diff.removedNodes.map((n) => n.externalId)).toEqual(['https://acme.example/p/2']);
    expect(diff.addedNodes.map((n) => n.externalId)).toEqual(['https://acme.example/p/3']);
    expect(diff.changedNodes).toHaveLength(1);
    expect(diff.changedNodes[0]!.changedFields).toContain('name');
    expect(diff.removedEdges).toHaveLength(1);
    expect(diff.addedEdges).toHaveLength(1);
    expect(diff.changedEdges).toHaveLength(0);
  });

  it('detects changed edge metadata', () => {
    const previous = new Graph({ now: fixedClock });
    const a = previous.addNode(node());
    const b = previous.addNode(node({ externalId: 'https://acme.example/p/2' }));
    previous.addEdge({ type: 'links_to', from: a.id, to: b.id, weight: 1, confidence: 1, source: 'crawler' });

    const current = new Graph({ now: fixedClock });
    const a2 = current.addNode(node());
    const b2 = current.addNode(node({ externalId: 'https://acme.example/p/2' }));
    current.addEdge({ type: 'links_to', from: a2.id, to: b2.id, weight: 0.5, confidence: 0.8, source: 'crawler' });

    const diff = diffGraphs(previous, current, {
      previousId: 'prev',
      currentId: 'curr',
      previousVersion: 1,
      currentVersion: 2,
    });
    expect(diff.addedNodes).toHaveLength(0);
    expect(diff.removedNodes).toHaveLength(0);
    expect(diff.changedEdges).toHaveLength(1);
    expect(diff.changedEdges[0]!.changedFields.sort()).toEqual(['confidence', 'weight']);
  });

  it('produces an empty diff for identical graphs', () => {
    const previous = new Graph({ now: fixedClock });
    previous.addNode(node());
    const current = new Graph({ now: fixedClock });
    current.addNode(node());
    const diff = diffGraphs(previous, current, {
      previousId: 'prev',
      currentId: 'curr',
      previousVersion: 1,
      currentVersion: 2,
    });
    expect(diff.addedNodes).toEqual([]);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.changedNodes).toEqual([]);
    expect(diff.addedEdges).toEqual([]);
    expect(diff.removedEdges).toEqual([]);
    expect(diff.changedEdges).toEqual([]);
  });

  it('compares nested properties with deep equality', () => {
    const make = (title: string) => {
      const graph = new Graph({ now: fixedClock });
      graph.addNode(node({ properties: { meta: { title } } }));
      return graph;
    };
    const diff = diffGraphs(make('one'), make('two'), {
      previousId: 'prev',
      currentId: 'curr',
      previousVersion: 1,
      currentVersion: 2,
    });
    expect(diff.changedNodes).toHaveLength(1);
    expect(diff.changedNodes[0]!.changedFields).toEqual(['properties']);

    const same = diffGraphs(make('same'), make('same'), {
      previousId: 'prev',
      currentId: 'curr',
      previousVersion: 1,
      currentVersion: 2,
    });
    expect(same.changedNodes).toHaveLength(0);
  });

  it('detects property changes across dates, arrays, and array/object mismatches', () => {
    const make = (properties: Record<string, unknown>) => {
      const graph = new Graph({ now: fixedClock });
      graph.addNode(node({ properties }));
      return graph;
    };
    const contexts = {
      previousId: 'prev',
      currentId: 'curr',
      previousVersion: 1,
      currentVersion: 2,
    };

    const dateChange = diffGraphs(
      make({ when: new Date('2026-01-01T00:00:00.000Z') }),
      make({ when: new Date('2026-01-02T00:00:00.000Z') }),
      contexts,
    );
    expect(dateChange.changedNodes).toHaveLength(1);

    const dateSame = diffGraphs(
      make({ when: new Date('2026-01-01T00:00:00.000Z') }),
      make({ when: new Date('2026-01-01T00:00:00.000Z') }),
      contexts,
    );
    expect(dateSame.changedNodes).toHaveLength(0);

    const arrayChange = diffGraphs(make({ tags: ['a', 'b'] }), make({ tags: ['a', 'b', 'c'] }), contexts);
    expect(arrayChange.changedNodes).toHaveLength(1);

    const arraySame = diffGraphs(make({ tags: ['a', 'b'] }), make({ tags: ['a', 'b'] }), contexts);
    expect(arraySame.changedNodes).toHaveLength(0);

    const shapeMismatch = diffGraphs(make({ tags: ['a'] }), make({ tags: { a: 1 } }), contexts);
    expect(shapeMismatch.changedNodes).toHaveLength(1);

    const keyMismatch = diffGraphs(make({ a: 1 }), make({ a: 1, b: 2 }), contexts);
    expect(keyMismatch.changedNodes).toHaveLength(1);

    const nestedArray = diffGraphs(
      make({ list: [{ x: 1 }, { y: 2 }] }),
      make({ list: [{ x: 1 }, { z: 3 }] }),
      contexts,
    );
    expect(nestedArray.changedNodes).toHaveLength(1);
  });

  it('reports changed node source, version, and updatedAt', () => {
    const previous = new Graph({ now: fixedClock });
    previous.addNode(node());
    previous.addNode(node({ externalId: 'https://acme.example/p/2' }));

    const current = new Graph({ now: () => new Date('2026-01-02T00:00:00.000Z') });
    current.addNode(node({ source: 'seo-engine' }));
    const changed = current.addNode(node({ externalId: 'https://acme.example/p/2' }));
    current.addNode(node({ externalId: 'https://acme.example/p/2' }));

    const diff = diffGraphs(previous, current, {
      previousId: 'prev',
      currentId: 'curr',
      previousVersion: 1,
      currentVersion: 2,
    });
    const fields = diff.changedNodes.map((entry) => entry.changedFields).flat();
    expect(fields).toContain('source');
    expect(fields).toContain('updatedAt');
    expect(entryHas(changed.id, diff.changedNodes)).toBe(true);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.addedNodes).toEqual([]);
  });

  it('reports changed edge source and properties', () => {
    const previous = new Graph({ now: fixedClock });
    const a = previous.addNode(node());
    const b = previous.addNode(node({ externalId: 'https://acme.example/p/2' }));
    previous.addEdge({ type: 'links_to', from: a.id, to: b.id, source: 'crawler' });

    const current = new Graph({ now: fixedClock });
    const a2 = current.addNode(node());
    const b2 = current.addNode(node({ externalId: 'https://acme.example/p/2' }));
    current.addEdge({ type: 'links_to', from: a2.id, to: b2.id, source: 'seo-engine', properties: { anchor: 'x' } });

    const diff = diffGraphs(previous, current, {
      previousId: 'prev',
      currentId: 'curr',
      previousVersion: 1,
      currentVersion: 2,
    });
    expect(diff.changedEdges).toHaveLength(1);
    expect(diff.changedEdges[0]!.changedFields.sort()).toEqual(['properties', 'source']);
  });
});

function entryHas(nodeId: string, entries: Array<{ node: { id: string } }>): boolean {
  return entries.some((entry) => entry.node.id === nodeId);
}

import { DomainError } from '@seogod/core';
import { describe, expect, it } from 'vitest';
import { DependencyGraph } from './dependency-graph.js';
import type { TaskStatus } from '../types/plan.js';

function buildGraph(): DependencyGraph {
  const graph = new DependencyGraph();
  graph.addNode('a');
  graph.addNode('b');
  graph.addNode('c');
  graph.addNode('d');
  graph.addDependency('a', 'b');
  graph.addDependency('b', 'c');
  graph.addDependency('a', 'c');
  graph.addDependency('c', 'd');
  return graph;
}

describe('DependencyGraph', () => {
  it('tracks node membership', () => {
    const graph = buildGraph();
    expect(graph.has('a')).toBe(true);
    expect(graph.has('missing')).toBe(false);
  });

  it('records and sorts prerequisites and dependents', () => {
    const graph = buildGraph();
    expect(graph.prerequisites('c')).toEqual(['a', 'b']);
    expect(graph.dependents('a')).toEqual(['b', 'c']);
  });

  it('computes transitive prerequisites', () => {
    const graph = buildGraph();
    expect(graph.transitivePrerequisites('d')).toEqual(['a', 'b', 'c']);
    expect(graph.transitivePrerequisites('a')).toEqual([]);
  });

  it('lists sorted edges', () => {
    expect(buildGraph().edges()).toEqual([
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ]);
  });

  it('reports an acyclic graph as cycle-free', () => {
    expect(buildGraph().hasCycles()).toBe(false);
    expect(buildGraph().findCycles()).toEqual([]);
  });

  it('detects cycles', () => {
    const graph = new DependencyGraph();
    graph.addDependency('a', 'b');
    graph.addDependency('b', 'c');
    graph.addDependency('c', 'a');
    expect(graph.hasCycles()).toBe(true);
    expect(graph.findCycles()).toHaveLength(1);
    expect(graph.findCycles()[0]).toEqual(['a', 'b', 'c']);
  });

  it('produces a deterministic topological order', () => {
    const order = buildGraph().topologicalOrder();
    expect(order).toHaveLength(4);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });

  it('throws when a cycle prevents ordering', () => {
    const graph = new DependencyGraph();
    graph.addDependency('a', 'b');
    graph.addDependency('b', 'a');
    expect(() => graph.topologicalOrder()).toThrow(DomainError);
  });

  describe('validatePrerequisites', () => {
    it('classifies ready, blocked, and pending tasks', () => {
      const graph = new DependencyGraph();
      graph.addNode('ready');
      graph.addNode('blocked');
      graph.addNode('pending');
      graph.addDependency('blocked', 'pending');
      graph.addDependency('ready', 'blocked');
      const statuses: ReadonlyMap<string, TaskStatus> = new Map([
        ['ready', 'COMPLETED'],
        ['blocked', 'PENDING'],
        ['pending', 'PENDING'],
      ]);
      const { ready, blocked, pending } = graph.validatePrerequisites(statuses);
      expect(ready).toEqual(['blocked']);
      expect(blocked).toEqual([]);
      expect(pending).toEqual(['pending']);
    });

    it('marks tasks blocked by a failed or skipped prerequisite', () => {
      const graph = new DependencyGraph();
      graph.addDependency('a', 'b');
      graph.addDependency('b', 'c');
      const statuses: ReadonlyMap<string, TaskStatus> = new Map([
        ['a', 'FAILED'],
        ['b', 'PENDING'],
        ['c', 'PENDING'],
      ]);
      const { ready, blocked, pending } = graph.validatePrerequisites(statuses);
      expect(blocked).toEqual(['b']);
      expect(pending).toEqual(['c']);
      expect(ready).toEqual([]);
    });

    it('ignores nodes without a recorded status', () => {
      const graph = new DependencyGraph();
      graph.addNode('unlisted');
      graph.addDependency('done', 'unlisted');
      const { ready, blocked, pending } = graph.validatePrerequisites(
        new Map<string, TaskStatus>([['done', 'COMPLETED']]),
      );
      expect(ready).toEqual([]);
      expect(blocked).toEqual([]);
      expect(pending).toEqual([]);
    });

    it('skips completed and skipped tasks', () => {
      const graph = new DependencyGraph();
      graph.addNode('done');
      graph.addNode('skipped');
      graph.addNode('run');
      graph.addDependency('done', 'run');
      graph.addDependency('skipped', 'run');
      const { ready, blocked, pending } = graph.validatePrerequisites(
        new Map<string, TaskStatus>([
          ['done', 'COMPLETED'],
          ['skipped', 'SKIPPED'],
          ['run', 'PENDING'],
        ]),
      );
      expect(ready).toEqual([]);
      expect(blocked).toEqual(['run']);
      expect(pending).toEqual([]);
    });
  });
});

import { DomainError } from '@seogod/core';
import type { TaskStatus } from '../types/plan.js';

export interface DependencyEdge {
  from: string;
  to: string;
}

/**
 * A directed acyclic graph of task dependencies. An edge `from → to` means
 * `from` must be executed before `to`. The graph supports cycle detection,
 * deterministic topological ordering, and prerequisite validation against task
 * statuses (used to classify tasks as ready / blocked / pending).
 */
export class DependencyGraph {
  private readonly nodes = new Set<string>();
  /** from → set of "to" ids (successors). */
  private readonly adjacency = new Map<string, Set<string>>();
  /** to → set of "from" ids (predecessors/prerequisites). */
  private readonly reverse = new Map<string, Set<string>>();

  addNode(id: string): this {
    this.nodes.add(id);
    return this;
  }

  /** Records that `to` depends on `from` (from must run first). */
  addDependency(from: string, to: string): this {
    this.nodes.add(from);
    this.nodes.add(to);
    const successors = this.adjacency.get(from) ?? new Set<string>();
    successors.add(to);
    this.adjacency.set(from, successors);
    const predecessors = this.reverse.get(to) ?? new Set<string>();
    predecessors.add(from);
    this.reverse.set(to, predecessors);
    return this;
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  /** Direct prerequisites of `id` (must complete first). */
  prerequisites(id: string): string[] {
    return [...(this.reverse.get(id) ?? [])].sort();
  }

  /** Direct dependents of `id` (things that wait on it). */
  dependents(id: string): string[] {
    return [...(this.adjacency.get(id) ?? [])].sort();
  }

  /** All prerequisites, transitively (breadth-first, sorted). */
  transitivePrerequisites(id: string): string[] {
    const visited = new Set<string>();
    const queue = [...this.prerequisites(id)];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      queue.push(...this.prerequisites(current));
    }
    return [...visited].sort();
  }

  edges(): DependencyEdge[] {
    const edges: DependencyEdge[] = [];
    for (const [from, successors] of this.adjacency) {
      for (const to of successors) {
        edges.push({ from, to });
      }
    }
    return edges.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
  }

  /** Detects whether the graph contains any directed cycle. */
  hasCycles(): boolean {
    return this.findCycles().length > 0;
  }

  /**
   * Finds all elementary cycles using depth-first search over the current
   * path. Returns each cycle as an ordered node list.
   */
  findCycles(): string[][] {
    const cycles: string[][] = [];
    const path: string[] = [];
    const pathSet = new Set<string>();
    const visited = new Set<string>();

    const visit = (node: string): void => {
      if (visited.has(node)) return;
      path.push(node);
      pathSet.add(node);
      for (const successor of this.dependents(node)) {
        if (pathSet.has(successor)) {
          const start = path.indexOf(successor);
          cycles.push([...path.slice(start)]);
        } else {
          visit(successor);
        }
      }
      pathSet.delete(node);
      path.pop();
      visited.add(node);
    };

    for (const node of [...this.nodes].sort()) {
      visit(node);
    }
    return cycles;
  }

  /** Deterministic topological order (Kahn). Throws on cycles. */
  topologicalOrder(): string[] {
    const inDegree = new Map<string, number>();
    for (const node of this.nodes) {
      inDegree.set(node, this.prerequisites(node).length);
    }
    const ready = [...this.nodes].filter((node) => inDegree.get(node) === 0).sort();
    const order: string[] = [];
    while (ready.length > 0) {
      const current = ready.shift();
      if (current === undefined) break;
      order.push(current);
      for (const successor of this.dependents(current)) {
        inDegree.set(successor, (inDegree.get(successor) ?? 1) - 1);
        if (inDegree.get(successor) === 0) {
          ready.push(successor);
          ready.sort();
        }
      }
    }
    if (order.length !== this.nodes.size) {
      throw new DomainError('dependency graph contains a cycle; cannot produce a topological order', {
        module: 'decision-engine',
        operation: 'dependencyGraph.topologicalOrder',
        context: { nodes: this.nodes.size, ordered: order.length },
      });
    }
    return order;
  }

  /**
   * Classifies nodes (that have a status) as ready / blocked / pending based on
   * their prerequisites' statuses. A node is ready when every prerequisite has
   * COMPLETED; blocked when a prerequisite FAILED or was SKIPPED; otherwise
   * pending.
   */
  validatePrerequisites(
    statuses: ReadonlyMap<string, TaskStatus>,
  ): { ready: string[]; blocked: string[]; pending: string[] } {
    const ready: string[] = [];
    const blocked: string[] = [];
    const pending: string[] = [];
    for (const id of this.nodes) {
      const status = statuses.get(id);
      if (status === undefined) continue;
      if (
        status === 'COMPLETED' ||
        status === 'SKIPPED' ||
        status === 'FAILED' ||
        status === 'ROLLED_BACK'
      ) {
        continue;
      }
      const prereqs = this.prerequisites(id);
      if (prereqs.some((prereq) => {
        const prereqStatus = statuses.get(prereq);
        return prereqStatus === 'FAILED' || prereqStatus === 'SKIPPED' || prereqStatus === 'BLOCKED';
      })) {
        blocked.push(id);
        continue;
      }
      if (prereqs.every((prereq) => statuses.get(prereq) === 'COMPLETED')) {
        ready.push(id);
      } else {
        pending.push(id);
      }
    }
    return { ready: ready.sort(), blocked: blocked.sort(), pending: pending.sort() };
  }
}

import type { Conflict, ConflictReport } from '../types/conflict.js';
import type { ExecutionTask, TaskActionType } from '../types/plan.js';

export interface ConflictContext {
  /** Latest knowledge-graph snapshot id; tasks on an older snapshot are stale. */
  latestSnapshotId?: string;
}

export interface ConflictDetectorOptions {
  /** Action-type pairs that cannot target the same resource. */
  incompatibleActions?: Array<[TaskActionType, TaskActionType]>;
  /** Groups of rule ids that are mutually exclusive on the same resource. */
  mutuallyExclusiveRules?: string[][];
}

const DEFAULT_INCOMPATIBLE: Array<[TaskActionType, TaskActionType]> = [
  ['delete_page', 'update_title'],
  ['delete_page', 'update_body'],
  ['delete_page', 'update_url'],
  ['delete_page', 'update_meta_description'],
  ['remove_structured_data', 'add_structured_data'],
  ['remove_redirect', 'update_url'],
];

const DEFAULT_EXCLUSIVE_RULES = [['remove-duplicate-content', 'merge-duplicate-content']];

/** Payload keys that carry planning metadata, not actual content changes. */
const PLANNING_METADATA_KEYS: ReadonlySet<string> = new Set([
  'snapshotId',
  'crawlJobId',
  'rule',
  'priority',
  'recommendedAction',
  'rationale',
]);

/**
 * Detects conflicts between planned tasks so the planner can deterministically
 * drop or flag them. Every check is deterministic and returns actionable
 * descriptions plus a suggested resolution.
 */
export class ConflictDetector {
  private readonly incompatiblePairs: Set<string>;
  private readonly exclusiveGroups: string[][];

  constructor(options: ConflictDetectorOptions = {}) {
    this.incompatiblePairs = new Set<string>();
    for (const [a, b] of options.incompatibleActions ?? DEFAULT_INCOMPATIBLE) {
      this.incompatiblePairs.add(`${a}\u0000${b}`);
      this.incompatiblePairs.add(`${b}\u0000${a}`);
    }
    this.exclusiveGroups = options.mutuallyExclusiveRules ?? DEFAULT_EXCLUSIVE_RULES;
  }

  detect(tasks: ExecutionTask[], context: ConflictContext = {}): ConflictReport {
    const conflicts: Conflict[] = [];
    const excluded = new Set<string>();
    const flagged = new Set<string>();

    this.detectDuplicates(tasks, conflicts, excluded);
    this.detectIncompatible(tasks, conflicts, excluded);
    this.detectOverwrites(tasks, conflicts, excluded);
    this.detectMutuallyExclusive(tasks, conflicts, excluded);
    this.detectStale(tasks, conflicts, context, flagged);

    conflicts.sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.involved.join('|').localeCompare(b.involved.join('|')),
    );

    return {
      conflicts,
      excludedTaskIds: [...excluded].sort(),
      flaggedTaskIds: [...flagged].sort(),
    };
  }

  private detectDuplicates(
    tasks: ExecutionTask[],
    conflicts: Conflict[],
    excluded: Set<string>,
  ): void {
    const byKey = new Map<string, ExecutionTask[]>();
    for (const task of tasks) {
      const key = `${task.rule}\u0000${task.actionType}\u0000${task.resourceId}`;
      const group = byKey.get(key) ?? [];
      group.push(task);
      byKey.set(key, group);
    }
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      const survivor = this.survivor(group);
      const involved = group.map((task) => task.id);
      for (const task of group) {
        if (task.id !== survivor.id) excluded.add(task.id);
      }
      conflicts.push({
        kind: 'duplicate',
        severity: 'ERROR',
        description: `Duplicate action: ${survivor.rule} on ${survivor.resourceId} appears ${group.length} times`,
        involved,
        resolution: `Keep the highest-priority task ${survivor.id}; drop the rest`,
      });
    }
  }

  private detectIncompatible(
    tasks: ExecutionTask[],
    conflicts: Conflict[],
    excluded: Set<string>,
  ): void {
    const byResource = this.groupByResource(tasks);
    for (const group of byResource.values()) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = group[i]!;
          const b = group[j]!;
          if (this.isIncompatible(a.actionType, b.actionType)) {
            const survivor = this.survivor([a, b]);
            const loser = survivor === a ? b : a;
            excluded.add(loser.id);
            conflicts.push({
              kind: 'incompatible',
              severity: 'ERROR',
              description: `Incompatible actions ${a.actionType} and ${b.actionType} target ${a.resourceId}`,
              involved: [a.id, b.id],
              resolution: `Drop ${loser.id} (${loser.actionType}) and keep ${survivor.id}`,
            });
          }
        }
      }
    }
  }

  private detectOverwrites(
    tasks: ExecutionTask[],
    conflicts: Conflict[],
    excluded: Set<string>,
  ): void {
    const byResource = this.groupByResource(tasks);
    for (const group of byResource.values()) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = group[i]!;
          const b = group[j]!;
          const sharedKeys = Object.keys(a.payload)
            .filter((key) => !PLANNING_METADATA_KEYS.has(key))
            .filter((key) => Object.prototype.hasOwnProperty.call(b.payload, key));
          const diverging = sharedKeys.filter(
            (key) => a.payload[key] !== b.payload[key],
          );
          if (diverging.length === 0) continue;
          const survivor = this.survivor([a, b]);
          const loser = survivor === a ? b : a;
          excluded.add(loser.id);
          conflicts.push({
            kind: 'overwrite',
            severity: 'ERROR',
            description: `Tasks overwrite each other on ${a.resourceId} for fields: ${diverging.join(', ')}`,
            involved: [a.id, b.id],
            resolution: `Keep ${survivor.id}; drop ${loser.id} so the change is unambiguous`,
          });
        }
      }
    }
  }

  private detectMutuallyExclusive(
    tasks: ExecutionTask[],
    conflicts: Conflict[],
    excluded: Set<string>,
  ): void {
    const byResource = this.groupByResource(tasks);
    for (const group of byResource.values()) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = group[i]!;
          const b = group[j]!;
          if (!this.sharesExclusiveGroup(a.rule, b.rule)) continue;
          const survivor = this.survivor([a, b]);
          const loser = survivor === a ? b : a;
          excluded.add(loser.id);
          conflicts.push({
            kind: 'mutually_exclusive',
            severity: 'ERROR',
            description: `Rules ${a.rule} and ${b.rule} are mutually exclusive on ${a.resourceId}`,
            involved: [a.id, b.id],
            resolution: `Apply only ${survivor.id}; drop ${loser.id}`,
          });
        }
      }
    }
  }

  private detectStale(
    tasks: ExecutionTask[],
    conflicts: Conflict[],
    context: ConflictContext,
    flagged: Set<string>,
  ): void {
    if (context.latestSnapshotId === undefined) return;
    for (const task of tasks) {
      const taskSnapshot = task.payload['snapshotId'];
      if (typeof taskSnapshot === 'string' && taskSnapshot !== context.latestSnapshotId) {
        flagged.add(task.id);
        conflicts.push({
          kind: 'stale',
          severity: 'WARNING',
          description: `Task derived from snapshot ${taskSnapshot} but latest is ${context.latestSnapshotId}`,
          involved: [task.id],
          resolution: 'Re-derive the task from the latest knowledge-graph snapshot before executing',
        });
      }
    }
  }

  private groupByResource(tasks: ExecutionTask[]): Map<string, ExecutionTask[]> {
    const byResource = new Map<string, ExecutionTask[]>();
    for (const task of tasks) {
      const group = byResource.get(task.resourceId) ?? [];
      group.push(task);
      byResource.set(task.resourceId, group);
    }
    for (const group of byResource.values()) {
      group.sort((a, b) => this.compareTasks(a, b));
    }
    return byResource;
  }

  private isIncompatible(a: TaskActionType, b: TaskActionType): boolean {
    return this.incompatiblePairs.has(`${a}\u0000${b}`);
  }

  private sharesExclusiveGroup(ruleA: string, ruleB: string): boolean {
    return this.exclusiveGroups.some(
      (group) => group.includes(ruleA) && group.includes(ruleB) && ruleA !== ruleB,
    );
  }

  /** Highest priority wins; ties break by id for determinism. */
  private survivor(tasks: ExecutionTask[]): ExecutionTask {
    return [...tasks].sort(this.compareTasks)[0]!;
  }

  private compareTasks(a: ExecutionTask, b: ExecutionTask): number {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  }
}

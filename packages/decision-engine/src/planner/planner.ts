import type { Decision } from '../types/decision.js';
import type {
  ExecutionBatch,
  ExecutionTask,
  PlanDependency,
  ResourceType,
  TaskActionType,
} from '../types/plan.js';
import type { PrioritizedRecommendation } from '../types/prioritizer.js';
import { DependencyGraph } from '../dependency-graph/dependency-graph.js';
import { Batcher } from '../batcher/batcher.js';
import { RollbackPlanGenerator } from '../execution-plan/rollback.js';
import { hasRollbackPotential, isDestructiveAction, isMutatingAction } from '../safety/safety-engine.js';
import { deterministicUuid } from '../utils/ids.js';

/** Default action-type estimate in seconds. */
const ACTION_ESTIMATE_SECONDS: Partial<Record<TaskActionType, number>> = {
  update_title: 15,
  update_meta_description: 15,
  update_description: 20,
  update_body: 120,
  update_url: 30,
  update_meta: 20,
  add_structured_data: 45,
  remove_structured_data: 30,
  fix_internal_links: 60,
  add_internal_links: 30,
  remove_internal_links: 30,
  update_alt_text: 15,
  add_image: 30,
  remove_image: 20,
  update_robots: 15,
  update_canonical: 15,
  remove_redirect: 30,
  create_page: 120,
  delete_page: 30,
  update_collection: 20,
  update_product: 20,
  update_blog: 20,
  update_article: 20,
};

/** Default engineering-effort estimate in hours per action. */
const ACTION_EFFORT_HOURS: Partial<Record<TaskActionType, number>> = {
  update_title: 0.1,
  update_meta_description: 0.1,
  update_description: 0.2,
  update_body: 1.5,
  update_url: 0.5,
  update_meta: 0.2,
  add_structured_data: 0.5,
  remove_structured_data: 0.3,
  fix_internal_links: 0.5,
  add_internal_links: 0.3,
  remove_internal_links: 0.3,
  update_alt_text: 0.1,
  add_image: 0.2,
  remove_image: 0.1,
  update_robots: 0.1,
  update_canonical: 0.1,
  remove_redirect: 0.3,
  create_page: 2,
  delete_page: 0.5,
  update_collection: 0.2,
  update_product: 0.2,
  update_blog: 0.2,
  update_article: 0.2,
};

/** Default mapping from recommendation rule to a concrete task action. */
export const DEFAULT_RULE_ACTION_MAP: Record<string, TaskActionType> = {
  'missing-title': 'update_title',
  'duplicate-titles': 'update_title',
  'missing-meta-description': 'update_meta_description',
  'duplicate-meta-descriptions': 'update_meta_description',
  'missing-structured-data': 'add_structured_data',
  'invalid-structured-data': 'add_structured_data',
  'broken-internal-links': 'fix_internal_links',
  'missing-internal-links': 'add_internal_links',
  'orphan-pages': 'add_internal_links',
  'thin-content': 'update_body',
  'duplicate-content': 'update_body',
  'missing-alt-text': 'update_alt_text',
  'slow-ttfb': 'update_meta',
  'missing-canonical': 'update_canonical',
  'duplicate-canonical': 'update_canonical',
  'blocked-robots': 'update_robots',
  'remove-duplicate-content': 'delete_page',
  'merge-duplicate-content': 'update_body',
};

export interface PlannerOptions {
  ruleActionMap?: Record<string, TaskActionType>;
  rulePrerequisites?: Record<string, string[]>;
  /** Seconds estimate override per action type. */
  actionEstimateSeconds?: Partial<Record<TaskActionType, number>>;
  /** Effort-hours estimate override per action type. */
  actionEffortHours?: Partial<Record<TaskActionType, number>>;
}

export interface CreateTasksInput {
  decision: Decision;
  planId: string;
  prioritized: PrioritizedRecommendation[];
  now: () => Date;
}

export interface AssembleInput {
  decision: Decision;
  planId: string;
  tasks: ExecutionTask[];
  /** Task ids dropped by the conflict detector. */
  excludedTaskIds: ReadonlySet<string>;
  /** Captured previous state per task id, used for rollback plans. */
  beforeValues?: Record<string, Record<string, unknown>>;
  maxChangesPerResource: number;
  now: () => Date;
}

export interface AssembleResult {
  tasks: ExecutionTask[];
  batches: ExecutionBatch[];
  orderedTaskIds: string[];
  dependencies: PlanDependency[];
  estimatedDurationMinutes: number;
  totalEffortHours: number;
  totalImpact: number;
  apiCalls: number;
}

export function planIdForDecision(decisionId: string, version: number): string {
  return deterministicUuid('execution-plan', `${decisionId}\u0000${version}`);
}

export function taskIdFor(decisionId: string, recommendationId: string, resourceId: string): string {
  return deterministicUuid('task', `${decisionId}\u0000${recommendationId}\u0000${resourceId}`);
}

/** Infers the Shopify resource type from a URL. */
export function resourceTypeFromUrl(url: string): ResourceType {
  if (/\/products\//.test(url)) return 'product';
  if (/\/collections\//.test(url)) return 'collection';
  if (/\/blogs\//.test(url)) return 'article';
  return 'page';
}

/**
 * Converts prioritized recommendations into one execution task per affected
 * resource. Fully deterministic: task ids derive from decision + recommendation
 * + resource, so re-planning produces identical tasks.
 */
export class ExecutionPlanner {
  private readonly ruleActionMap: Record<string, TaskActionType>;
  private readonly rulePrerequisites: Record<string, string[]>;
  private readonly actionEstimateSeconds: Partial<Record<TaskActionType, number>>;
  private readonly actionEffortHours: Partial<Record<TaskActionType, number>>;

  constructor(options: PlannerOptions = {}) {
    this.ruleActionMap = { ...DEFAULT_RULE_ACTION_MAP, ...options.ruleActionMap };
    this.rulePrerequisites = options.rulePrerequisites ?? {};
    this.actionEstimateSeconds = { ...ACTION_ESTIMATE_SECONDS, ...options.actionEstimateSeconds };
    this.actionEffortHours = { ...ACTION_EFFORT_HOURS, ...options.actionEffortHours };
  }

  createTasks(input: CreateTasksInput): ExecutionTask[] {
    const { decision, planId, prioritized, now } = input;
    const snapshotId = decision.context.graph?.snapshotId ?? null;
    const tasks: ExecutionTask[] = [];
    for (const entry of prioritized) {
      const urls = [...new Set(entry.recommendation.affectedUrls)].sort();
      for (const url of urls) {
        const actionType = this.ruleActionMap[entry.recommendation.rule] ?? 'custom';
        const task: ExecutionTask = {
          id: taskIdFor(decision.id, entry.recommendation.id, url),
          storeId: decision.storeId,
          decisionId: decision.id,
          planId,
          recommendationId: entry.recommendation.id,
          rule: entry.recommendation.rule,
          actionType,
          resourceType: resourceTypeFromUrl(url),
          resourceId: url,
          resourceRef: url,
          payload: {
            snapshotId,
            crawlJobId: entry.recommendation.crawlJobId,
            rule: entry.recommendation.rule,
            priority: entry.recommendation.priority,
            recommendedAction: entry.recommendation.recommendedAction,
            rationale: entry.recommendation.rationale,
          },
          priority: entry.score,
          status: 'PENDING',
          dependsOn: [],
          isMutating: isMutatingAction(actionType),
          risk: this.taskRisk(actionType),
          estimatedSeconds: this.actionEstimateSeconds[actionType] ?? 60,
          rollback: null,
          result: null,
          createdAt: now(),
          updatedAt: now(),
        };
        tasks.push(task);
      }
    }
    return tasks;
  }

  assemble(input: AssembleInput): AssembleResult {
    const tasks = input.tasks.filter((task) => !input.excludedTaskIds.has(task.id));
    const capped = this.capPerResource(tasks, input.maxChangesPerResource);

    const graph = new DependencyGraph();
    for (const task of capped) {
      graph.addNode(task.id);
    }
    const dependencies = this.buildDependencies(graph, capped);
    const orderedTaskIds = graph.topologicalOrder();
    const orderOf = new Map<string, number>();
    orderedTaskIds.forEach((id, index) => orderOf.set(id, index));

    const batcher = new Batcher();
    const batches = batcher.group(capped, {
      planId: input.planId,
      storeId: input.decision.storeId,
      orderOf,
    });

    const generator = new RollbackPlanGenerator();
    for (const task of capped) {
      if (task.isMutating) {
        task.rollback = generator.generate(task, input.beforeValues?.[task.id] ?? {});
      }
    }

    const apiCalls = batches.reduce((sum, batch) => sum + batch.apiCalls, 0);
    const estimatedDurationMinutes = Math.ceil(
      batches.reduce((sum, batch) => sum + batch.estimatedSeconds, 0) / 60,
    );
    const totalEffortHours = this.totalEffortHours(capped);
    const totalImpact = this.totalImpact(capped);

    return {
      tasks: capped,
      batches,
      orderedTaskIds,
      dependencies,
      estimatedDurationMinutes,
      totalEffortHours,
      totalImpact,
      apiCalls,
    };
  }

  /** Orders same-resource tasks sequentially (highest priority first). */
  private buildDependencies(
    graph: DependencyGraph,
    tasks: ExecutionTask[],
  ): PlanDependency[] {
    const dependencies: PlanDependency[] = [];
    const byRule = new Map<string, ExecutionTask[]>();
    const byResource = new Map<string, ExecutionTask[]>();
    for (const task of tasks) {
      const ruleGroup = byRule.get(task.rule) ?? [];
      ruleGroup.push(task);
      byRule.set(task.rule, ruleGroup);
      const resourceGroup = byResource.get(task.resourceId) ?? [];
      resourceGroup.push(task);
      byResource.set(task.resourceId, resourceGroup);
    }

    for (const task of tasks) {
      const prerequisites = this.rulePrerequisites[task.rule] ?? [];
      for (const prereqRule of prerequisites) {
        for (const candidate of byRule.get(prereqRule) ?? []) {
          if (candidate.resourceId === task.resourceId && candidate.id !== task.id) {
            graph.addDependency(candidate.id, task.id);
            dependencies.push({ taskId: task.id, dependsOn: candidate.id });
          }
        }
      }
    }

    for (const group of byResource.values()) {
      const sorted = [...group].sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.id.localeCompare(b.id);
      });
      for (let i = 1; i < sorted.length; i += 1) {
        const previous = sorted[i - 1]!;
        const current = sorted[i]!;
        if (previous.id === current.id) continue;
        graph.addDependency(previous.id, current.id);
        dependencies.push({ taskId: current.id, dependsOn: previous.id });
      }
    }

    dependencies.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.dependsOn.localeCompare(b.dependsOn));
    return dependencies;
  }

  /** Keeps at most `max` tasks per resource, by priority. */
  private capPerResource(tasks: ExecutionTask[], max: number): ExecutionTask[] {
    if (max <= 0) return tasks;
    const byResource = new Map<string, ExecutionTask[]>();
    for (const task of tasks) {
      const group = byResource.get(task.resourceId) ?? [];
      group.push(task);
      byResource.set(task.resourceId, group);
    }
    const kept: ExecutionTask[] = [];
    for (const group of byResource.values()) {
      const sorted = [...group].sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.id.localeCompare(b.id);
      });
      kept.push(...sorted.slice(0, max));
    }
    return kept;
  }

  private taskRisk(actionType: TaskActionType): ExecutionTask['risk'] {
    if (isDestructiveAction(actionType)) return 'HIGH';
    if (isMutatingAction(actionType) && !hasRollbackPotential(actionType)) return 'MEDIUM';
    return 'LOW';
  }

  private totalEffortHours(tasks: ExecutionTask[]): number {
    const hours = tasks.reduce(
      (sum, task) => sum + (this.actionEffortHours[task.actionType] ?? 0.5),
      0,
    );
    return Math.round(hours * 10) / 10;
  }

  private totalImpact(tasks: ExecutionTask[]): number {
    if (tasks.length === 0) return 0;
    const avg = tasks.reduce((sum, task) => sum + task.priority, 0) / tasks.length;
    return Math.round(avg);
  }
}

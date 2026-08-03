import { describe, expect, it } from 'vitest';
import {
  decisionInput,
  fixedClock,
  graphContext,
  ORIGIN,
  recommendation,
} from '../test/fixtures.js';
import { DecisionModel } from '../models/decision.js';
import { DecisionSummaryModel } from '../models/decision-summary.js';
import { Prioritizer } from '../prioritizer/prioritizer.js';
import {
  DEFAULT_RULE_ACTION_MAP,
  ExecutionPlanner,
  planIdForDecision,
  resourceTypeFromUrl,
  taskIdFor,
} from './planner.js';
import type { Decision } from '../types/decision.js';
import type { DecisionEngineInput } from '../types/input.js';

function makeDecision(input: DecisionEngineInput): Decision {
  const prioritized = new Prioritizer().prioritize(input);
  return DecisionModel.create({
    input,
    prioritized,
    summary: DecisionSummaryModel.initial(input),
    now: fixedClock,
  });
}

describe('id helpers', () => {
  it('derives stable plan and task ids', () => {
    expect(planIdForDecision('decision-1', 1)).toBe(planIdForDecision('decision-1', 1));
    expect(planIdForDecision('decision-1', 1)).not.toBe(planIdForDecision('decision-1', 2));
    expect(taskIdFor('decision-1', 'r1', '/a')).toBe(taskIdFor('decision-1', 'r1', '/a'));
    expect(taskIdFor('decision-1', 'r1', '/a')).not.toBe(taskIdFor('decision-1', 'r1', '/b'));
  });
});

describe('resourceTypeFromUrl', () => {
  it('infers the Shopify resource type', () => {
    expect(resourceTypeFromUrl(`${ORIGIN}/products/1`)).toBe('product');
    expect(resourceTypeFromUrl(`${ORIGIN}/collections/all`)).toBe('collection');
    expect(resourceTypeFromUrl(`${ORIGIN}/blogs/hello`)).toBe('article');
    expect(resourceTypeFromUrl(`${ORIGIN}/about`)).toBe('page');
  });
});

describe('ExecutionPlanner.createTasks', () => {
  it('creates one deterministic task per unique affected URL', () => {
    const input = decisionInput({
      graph: graphContext(),
      recommendations: [
        recommendation({ id: 'r1', rule: 'missing-title', affectedUrls: [`${ORIGIN}/b`, `${ORIGIN}/a`, `${ORIGIN}/a`] }),
      ],
    });
    const decision = makeDecision(input);
    const prioritized = new Prioritizer().prioritize(input);
    const planner = new ExecutionPlanner();
    const tasks = planner.createTasks({ decision, planId: 'plan-1', prioritized, now: fixedClock });

    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.resourceId).toBe(`${ORIGIN}/a`);
    expect(tasks[1]!.resourceId).toBe(`${ORIGIN}/b`);
    expect(tasks[0]!.actionType).toBe('update_title');
    expect(tasks[0]!.status).toBe('PENDING');
    expect(tasks[0]!.payload['snapshotId']).toBe('snapshot-1');
    expect(tasks[0]!.isMutating).toBe(true);
    expect(tasks[0]!.risk).toBe('LOW');
    expect(tasks[0]!.id).toBe(taskIdFor(decision.id, 'r1', `${ORIGIN}/a`));
  });

  it('maps rules to actions and falls back to custom', () => {
    const input = decisionInput({
      recommendations: [
        recommendation({ id: 'r1', rule: 'remove-duplicate-content', affectedUrls: [`${ORIGIN}/a`] }),
        recommendation({ id: 'r2', rule: 'totally-unknown', affectedUrls: [`${ORIGIN}/a`] }),
      ],
    });
    const decision = makeDecision(input);
    const prioritized = new Prioritizer().prioritize(input);
    const planner = new ExecutionPlanner();
    const tasks = planner.createTasks({ decision, planId: 'plan-1', prioritized, now: fixedClock });

    const destructive = tasks.find((entry) => entry.recommendationId === 'r1')!;
    expect(destructive.actionType).toBe('delete_page');
    expect(destructive.risk).toBe('HIGH');

    const custom = tasks.find((entry) => entry.recommendationId === 'r2')!;
    expect(custom.actionType).toBe('custom');
    expect(custom.isMutating).toBe(false);
  });

  it('honors a custom rule-to-action map', () => {
    const planner = new ExecutionPlanner({ ruleActionMap: { 'missing-title': 'update_body' } });
    const input = decisionInput({ recommendations: [recommendation()] });
    const decision = makeDecision(input);
    const prioritized = new Prioritizer().prioritize(input);
    const tasks = planner.createTasks({ decision, planId: 'plan-1', prioritized, now: fixedClock });
    expect(tasks[0]!.actionType).toBe('update_body');
  });
});

describe('ExecutionPlanner.assemble', () => {
  it('excludes conflicted tasks and produces an ordered, batched plan', () => {
    const input = decisionInput({
      graph: graphContext(),
      recommendations: [
        recommendation({ id: 'r1', rule: 'missing-title', affectedUrls: [`${ORIGIN}/a`, `${ORIGIN}/b`] }),
        recommendation({ id: 'r2', rule: 'thin-content', affectedUrls: [`${ORIGIN}/a`] }),
      ],
    });
    const decision = makeDecision(input);
    const prioritized = new Prioritizer().prioritize(input);
    const planner = new ExecutionPlanner();
    const tasks = planner.createTasks({ decision, planId: 'plan-1', prioritized, now: fixedClock });
    const excluded = new Set([taskIdFor(decision.id, 'r1', `${ORIGIN}/b`)]);

    const assembled = planner.assemble({
      decision,
      planId: 'plan-1',
      tasks,
      excludedTaskIds: excluded,
      maxChangesPerResource: 3,
      now: fixedClock,
    });

    expect(assembled.tasks).toHaveLength(2);
    expect(assembled.orderedTaskIds).toHaveLength(2);
    expect(assembled.dependencies.length).toBeGreaterThan(0);
    expect(assembled.batches.length).toBeGreaterThan(0);
    expect(assembled.apiCalls).toBe(2);
    expect(assembled.estimatedDurationMinutes).toBeGreaterThanOrEqual(1);
    expect(assembled.totalEffortHours).toBeGreaterThan(0);
    expect(assembled.totalImpact).toBeGreaterThan(0);

    const sameResource = assembled.dependencies.find(
      (dependency) => dependency.taskId === taskIdFor(decision.id, 'r2', `${ORIGIN}/a`),
    );
    expect(sameResource?.dependsOn).toBe(taskIdFor(decision.id, 'r1', `${ORIGIN}/a`));
  });

  it('caps the number of changes per resource', () => {
    const input = decisionInput({
      recommendations: [
        recommendation({ id: 'r1', affectedUrls: [`${ORIGIN}/a`] }),
        recommendation({ id: 'r2', affectedUrls: [`${ORIGIN}/a`] }),
        recommendation({ id: 'r3', affectedUrls: [`${ORIGIN}/a`] }),
      ],
    });
    const decision = makeDecision(input);
    const prioritized = new Prioritizer().prioritize(input);
    const planner = new ExecutionPlanner();
    const tasks = planner.createTasks({ decision, planId: 'plan-1', prioritized, now: fixedClock });
    const assembled = planner.assemble({
      decision,
      planId: 'plan-1',
      tasks,
      excludedTaskIds: new Set(),
      maxChangesPerResource: 2,
      now: fixedClock,
    });
    expect(assembled.tasks).toHaveLength(2);
  });

  it('generates rollback plans for mutating tasks from before-values', () => {
    const input = decisionInput({ recommendations: [recommendation()] });
    const decision = makeDecision(input);
    const prioritized = new Prioritizer().prioritize(input);
    const planner = new ExecutionPlanner();
    const tasks = planner.createTasks({ decision, planId: 'plan-1', prioritized, now: fixedClock });
    const taskId = tasks[0]!.id;

    const without = planner.assemble({
      decision,
      planId: 'plan-1',
      tasks,
      excludedTaskIds: new Set(),
      maxChangesPerResource: 3,
      now: fixedClock,
    });
    expect(without.tasks[0]!.rollback?.available).toBe(false);

    const withBefore = planner.assemble({
      decision,
      planId: 'plan-1',
      tasks,
      excludedTaskIds: new Set(),
      beforeValues: { [taskId]: { title: 'Old title' } },
      maxChangesPerResource: 3,
      now: fixedClock,
    });
    expect(withBefore.tasks[0]!.rollback?.available).toBe(true);
    expect(withBefore.tasks[0]!.rollback?.steps).toHaveLength(1);
  });

  it('orders same-resource tasks sequentially by priority', () => {
    const input = decisionInput({
      recommendations: [
        recommendation({ id: 'r-low', affectedUrls: [`${ORIGIN}/a`], confidence: 0.1 }),
        recommendation({ id: 'r-high', affectedUrls: [`${ORIGIN}/a`], confidence: 0.9 }),
      ],
    });
    const decision = makeDecision(input);
    const prioritized = new Prioritizer().prioritize(input);
    const planner = new ExecutionPlanner();
    const tasks = planner.createTasks({ decision, planId: 'plan-1', prioritized, now: fixedClock });
    const assembled = planner.assemble({
      decision,
      planId: 'plan-1',
      tasks,
      excludedTaskIds: new Set(),
      maxChangesPerResource: 3,
      now: fixedClock,
    });

    const byId = new Map(tasks.map((entry) => [entry.id, entry]));
    const high = byId.get(taskIdFor(decision.id, 'r-high', `${ORIGIN}/a`))!;
    const low = byId.get(taskIdFor(decision.id, 'r-low', `${ORIGIN}/a`))!;
    expect(assembled.orderedTaskIds.indexOf(high.id)).toBeLessThan(
      assembled.orderedTaskIds.indexOf(low.id),
    );
    expect(assembled.dependencies).toContainEqual({ taskId: low.id, dependsOn: high.id });
  });

  it('supports rule prerequisites', () => {
    const planner = new ExecutionPlanner({
      rulePrerequisites: { 'thin-content': ['missing-title'] },
    });
    const input = decisionInput({
      recommendations: [
        recommendation({ id: 'r1', rule: 'missing-title', affectedUrls: [`${ORIGIN}/a`] }),
        recommendation({ id: 'r2', rule: 'thin-content', affectedUrls: [`${ORIGIN}/a`] }),
      ],
    });
    const decision = makeDecision(input);
    const prioritized = new Prioritizer().prioritize(input);
    const tasks = planner.createTasks({ decision, planId: 'plan-1', prioritized, now: fixedClock });
    const assembled = planner.assemble({
      decision,
      planId: 'plan-1',
      tasks,
      excludedTaskIds: new Set(),
      maxChangesPerResource: 3,
      now: fixedClock,
    });
    const bodyTask = assembled.tasks.find((entry) => entry.rule === 'thin-content')!;
    const titleTask = assembled.tasks.find((entry) => entry.rule === 'missing-title')!;
    expect(assembled.dependencies).toContainEqual({ taskId: bodyTask.id, dependsOn: titleTask.id });
  });

  it('ignores rule prerequisites without a same-resource candidate', () => {
    const planner = new ExecutionPlanner({
      rulePrerequisites: { 'thin-content': ['missing-title', 'absent-rule'] },
    });
    const input = decisionInput({
      recommendations: [
        recommendation({ id: 'r1', rule: 'missing-title', affectedUrls: [`${ORIGIN}/a`] }),
        recommendation({ id: 'r2', rule: 'thin-content', affectedUrls: [`${ORIGIN}/b`] }),
      ],
    });
    const decision = makeDecision(input);
    const prioritized = new Prioritizer().prioritize(input);
    const tasks = planner.createTasks({ decision, planId: 'plan-1', prioritized, now: fixedClock });
    const assembled = planner.assemble({
      decision,
      planId: 'plan-1',
      tasks,
      excludedTaskIds: new Set(),
      maxChangesPerResource: 3,
      now: fixedClock,
    });
    const thin = assembled.tasks.find((entry) => entry.rule === 'thin-content')!;
    expect(assembled.dependencies.some((entry) => entry.taskId === thin.id)).toBe(false);
  });

  it('handles empty task sets and zero caps gracefully', () => {
    const input = decisionInput({ recommendations: [recommendation()] });
    const decision = makeDecision(input);
    const prioritized = new Prioritizer().prioritize(input);
    const planner = new ExecutionPlanner();
    const tasks = planner.createTasks({ decision, planId: 'plan-1', prioritized, now: fixedClock });
    const allExcluded = new Set(tasks.map((entry) => entry.id));
    const assembled = planner.assemble({
      decision,
      planId: 'plan-1',
      tasks,
      excludedTaskIds: allExcluded,
      maxChangesPerResource: 0,
      now: fixedClock,
    });
    expect(assembled.tasks).toHaveLength(0);
    expect(assembled.totalImpact).toBe(0);
    expect(assembled.estimatedDurationMinutes).toBe(0);
  });
});

describe('DEFAULT_RULE_ACTION_MAP', () => {
  it('maps the documented rules to actions', () => {
    expect(DEFAULT_RULE_ACTION_MAP['missing-title']).toBe('update_title');
    expect(DEFAULT_RULE_ACTION_MAP['remove-duplicate-content']).toBe('delete_page');
    expect(DEFAULT_RULE_ACTION_MAP['merge-duplicate-content']).toBe('update_body');
  });
});

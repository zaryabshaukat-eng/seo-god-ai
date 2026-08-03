import { describe, expect, it } from 'vitest';
import { WorkflowPlanner, defaultTaskSchema } from './workflow-planner.js';
import { AgentRegistry } from '../registry/agent-registry.js';
import { agentDefinition, executionPlan, executionTask } from '../test/fixtures.js';

describe('defaultTaskSchema', () => {
  it('constrains the action enum and requires resourceId', () => {
    const schema = defaultTaskSchema(executionTask({ actionType: 'update_title' }));
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['action', 'resourceId']);
    expect((schema.properties?.action as { enum: unknown[] }).enum).toEqual(['update_title']);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('WorkflowPlanner', () => {
  function registry(): AgentRegistry {
    const registry = new AgentRegistry();
    registry.register(agentDefinition());
    return registry;
  }

  it('converts an execution plan into a deterministic workflow', () => {
    const planner = new WorkflowPlanner({ registry: registry() });
    const workflow = planner.plan(executionPlan());
    expect(workflow.definition.name).toBe('plan-plan-1');
    expect(workflow.definition.version).toBe(1);
    expect(workflow.definition.steps).toHaveLength(1);
    const group = workflow.definition.steps[0];
    expect(group?.kind).toBe('parallel');
    if (group !== undefined && group.kind === 'parallel') {
      expect(group.id).toBe('batch-batch-1');
      expect(group.steps).toHaveLength(1);
      expect(group.steps[0]?.id).toBe('step-t-1');
      const step = group.steps[0];
      if (step !== undefined && step.kind === 'agent') {
        expect(step.agentId).toBe('title-writer');
        expect(step.allowedActions).toEqual(['update_title']);
        expect(step.timeoutMs).toBe(60_000);
      }
    }
    expect(workflow.assignments['step-t-1']).toBe('title-writer');
    expect(workflow.source).toEqual({
      planId: 'plan-1',
      decisionId: 'decision-1',
      storeId: 'store-1',
      taskCount: 1,
    });
  });

  it('is deterministic for the same plan', () => {
    const planner = new WorkflowPlanner({ registry: registry() });
    const a = planner.plan(executionPlan());
    const b = planner.plan(executionPlan());
    expect(a.definition.id).toBe(b.definition.id);
    expect(JSON.stringify(a.definition.steps)).toBe(JSON.stringify(b.definition.steps));
  });

  it('creates one parallel group per batch in order', () => {
    const plan = executionPlan({
      tasks: [
        executionTask({ id: 't1' }),
        executionTask({ id: 't2' }),
        executionTask({ id: 't3' }),
      ],
      batches: [
        { ...executionPlan().batches[0]!, id: 'batch-1', order: 2, taskIds: ['t3'] },
        { ...executionPlan().batches[0]!, id: 'batch-2', order: 1, taskIds: ['t1', 't2'] },
      ],
    });
    const planner = new WorkflowPlanner({ registry: registry() });
    const workflow = planner.plan(plan);
    const groups = workflow.definition.steps;
    expect(groups.map((group) => (group.kind === 'parallel' ? group.id : undefined))).toEqual([
      'batch-batch-2',
      'batch-batch-1',
    ]);
    const second = groups[1];
    if (second !== undefined && second.kind === 'parallel') {
      expect(second.steps.map((step) => step.id)).toEqual(['step-t3']);
      expect(second.maxConcurrency).toBe(1);
    }
  });

  it('skips empty batches', () => {
    const plan = executionPlan({ batches: [] });
    const workflow = new WorkflowPlanner({ registry: registry() }).plan(plan);
    expect(workflow.definition.steps).toHaveLength(0);
  });

  it('skips a batch whose tasks are all missing', () => {
    const plan = executionPlan({
      batches: [{ ...executionPlan().batches[0]!, id: 'batch-x', taskIds: ['does-not-exist'] }],
    });
    const workflow = new WorkflowPlanner({ registry: registry() }).plan(plan);
    expect(workflow.definition.steps).toHaveLength(0);
  });

  it('tolerates a resolveAgent that returns an empty id', () => {
    const workflow = new WorkflowPlanner({ registry: registry() }).plan(executionPlan(), {
      resolveAgent: () => undefined as unknown as string,
    });
    const group = workflow.definition.steps[0];
    if (group !== undefined && group.kind === 'parallel') {
      expect(group.steps[0]).toMatchObject({ agentId: '' });
    }
  });

  it('honours resolveAgent, batchConcurrency, and schema overrides', () => {
    const plan = executionPlan({
      tasks: [executionTask({ id: 't1' }), executionTask({ id: 't2' })],
      batches: [{ ...executionPlan().batches[0]!, taskIds: ['t1', 't2'] }],
    });
    const workflow = new WorkflowPlanner({
      registry: registry(),
      taskSchemaBuilder: () => ({ type: 'string' }),
    }).plan(plan, {
      resolveAgent: () => 'custom-agent',
      batchConcurrency: 1,
    });
    const group = workflow.definition.steps[0];
    if (group !== undefined && group.kind === 'parallel') {
      expect(group.maxConcurrency).toBe(1);
      expect(group.steps[0]).toMatchObject({ agentId: 'custom-agent', schema: { type: 'string' } });
    }
  });

  it('uses the configured default resolveAgent when no override is given', () => {
    const custom = new WorkflowPlanner({
      registry: registry(),
      resolveAgent: () => 'fallback-agent',
    });
    const workflow = custom.plan(executionPlan());
    const group = workflow.definition.steps[0];
    if (group !== undefined && group.kind === 'parallel') {
      const step = group.steps[0];
      if (step !== undefined && step.kind === 'agent') expect(step.agentId).toBe('fallback-agent');
    }
  });
});

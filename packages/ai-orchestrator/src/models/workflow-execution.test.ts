import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from '../types/workflow.js';
import { countAgentSteps, WorkflowExecutionModel } from './workflow-execution.js';
import { workflowDefinition } from '../test/fixtures.js';
import { agentResult } from '../test/fixtures.js';

describe('WorkflowExecutionModel', () => {
  it('derives stable execution ids per definition and store', () => {
    const a = WorkflowExecutionModel.idFor('def-1', 'store-1');
    const b = WorkflowExecutionModel.idFor('def-1', 'store-1');
    const c = WorkflowExecutionModel.idFor('def-1', 'store-2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('creates a PENDING execution from a definition', () => {
    const now = () => new Date('2026-01-01T00:00:00Z');
    const execution = WorkflowExecutionModel.create({
      definition: workflowDefinition({ id: 'def-1' }),
      storeId: 'store-1',
      inputs: { x: 1 },
      now,
    });
    expect(execution.status).toBe('PENDING');
    expect(execution.definitionId).toBe('def-1');
    expect(execution.storeId).toBe('store-1');
    expect(execution.inputs).toEqual({ x: 1 });
    expect(execution.outputs).toEqual({});
    expect(execution.steps).toEqual([]);
    expect(execution.checkpointedAt).toBeNull();
  });

  it('creates a step execution', () => {
    const step: WorkflowStep = { id: 's1', kind: 'agent', agentId: 'a', taskTemplate: 't' };
    const stepExecution = WorkflowExecutionModel.createStep({ step });
    expect(stepExecution.stepId).toBe('s1');
    expect(stepExecution.kind).toBe('agent');
    expect(stepExecution.status).toBe('PENDING');
  });

  it('transitions status with optional fields', () => {
    const execution = WorkflowExecutionModel.create({
      definition: workflowDefinition(),
      storeId: 'store-1',
      inputs: {},
    });
    const updated = WorkflowExecutionModel.transition(execution, 'COMPLETED', {
      completedAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(updated.status).toBe('COMPLETED');
    expect(updated.completedAt).not.toBeNull();
    expect(updated.steps).toEqual(execution.steps);
  });

  it('records agent outputs by step id', () => {
    const execution = WorkflowExecutionModel.create({
      definition: workflowDefinition(),
      storeId: 'store-1',
      inputs: {},
    });
    const updated = WorkflowExecutionModel.recordOutput(execution, 's1', agentResult());
    expect(updated.outputs['s1']).toEqual(agentResult());
    expect(execution.outputs).toEqual({});
  });

  it('marks step status preserving other steps', () => {
    const base = WorkflowExecutionModel.create({
      definition: workflowDefinition(),
      storeId: 'store-1',
      inputs: {},
    });
    const withA = WorkflowExecutionModel.createStep({ step: { id: 'a', kind: 'agent', agentId: 'x', taskTemplate: 't' } });
    const withB = WorkflowExecutionModel.createStep({ step: { id: 'b', kind: 'agent', agentId: 'y', taskTemplate: 't' } });
    base.steps.push(withA, withB);
    const updated = WorkflowExecutionModel.markStep(base, 'a', 'COMPLETED', { attempt: 1 });
    expect(updated.steps.find((s) => s.stepId === 'a')?.status).toBe('COMPLETED');
    expect(updated.steps.find((s) => s.stepId === 'b')?.status).toBe('PENDING');
  });

  it('stamps a checkpoint timestamp', () => {
    const now = () => new Date('2026-01-01T00:00:00Z');
    const execution = WorkflowExecutionModel.create({
      definition: workflowDefinition(),
      storeId: 'store-1',
      inputs: {},
    });
    expect(WorkflowExecutionModel.checkpoint(execution, now).checkpointedAt).toEqual(now());
  });

  it('stamps a checkpoint with the default clock', () => {
    const execution = WorkflowExecutionModel.create({
      definition: workflowDefinition(),
      storeId: 'store-1',
      inputs: {},
    });
    expect(WorkflowExecutionModel.checkpoint(execution).checkpointedAt).not.toBeNull();
  });

  it('counts agent steps across every step kind', () => {
    const nested: WorkflowStep[] = [
      { id: 'a1', kind: 'agent', agentId: 'x', taskTemplate: 't' },
      { id: 'seq', kind: 'sequential', steps: [{ id: 'a2', kind: 'agent', agentId: 'x', taskTemplate: 't' }] },
      { id: 'par', kind: 'parallel', steps: [{ id: 'a3', kind: 'agent', agentId: 'x', taskTemplate: 't' }] },
      {
        id: 'cond',
        kind: 'conditional',
        condition: { key: 'steps.x', operator: 'exists' },
        whenTrue: [{ id: 'a4', kind: 'agent', agentId: 'x', taskTemplate: 't' }],
        whenFalse: [{ id: 'a5', kind: 'agent', agentId: 'x', taskTemplate: 't' }],
      },
    ];
    expect(nested.reduce((sum, step) => sum + countAgentSteps(step), 0)).toBe(5);
  });
});

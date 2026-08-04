import { describe, expect, it } from 'vitest';
import type { Execution, ExecutionStep } from '../types/execution.js';
import { buildExecution, buildStep } from '../models/execution.js';
import { ApprovalGate } from './gate.js';

function makeStep(id: string, requiresApproval: boolean, approved: boolean): ExecutionStep {
  return buildStep({
    executionId: 'e1',
    batchId: 'b1',
    storeId: 's1',
    actionType: 'update_title',
    resourceType: 'product',
    resourceId: id,
    payload: { title: 'x' },
    order: 0,
    requiresApproval,
    approved,
  });
}

function makeExecution(steps: ExecutionStep[]): Execution {
  return buildExecution({
    id: 'e1',
    storeId: 's1',
    mode: 'STAGING',
    source: 'plan',
    steps,
    batches: [],
  });
}

describe('ApprovalGate', () => {
  it('approves steps and records the decision', () => {
    const gate = new ApprovalGate();
    gate.approve('e1', ['s1'], 'bob');
    expect(gate.decisionFor('s1')?.approved).toBe(true);
    expect(gate.decisionFor('s1')?.decidedBy).toBe('bob');
    expect(gate.decisionFor('s1')?.decidedAt).toBeInstanceOf(Date);
  });

  it('rejects steps with a reason', () => {
    const gate = new ApprovalGate();
    gate.reject('e1', ['s1'], 'not worth it');
    expect(gate.decisionFor('s1')).toEqual(
      expect.objectContaining({ stepId: 's1', approved: false, reason: 'not worth it' }),
    );
  });

  it('returns null for unknown steps', () => {
    expect(new ApprovalGate().decisionFor('nope')).toBeNull();
  });

  it('lists pending approvals', () => {
    const gate = new ApprovalGate();
    const s1 = makeStep('s1', true, false);
    const s2 = makeStep('s2', true, true);
    const s3 = makeStep('s3', false, false);
    const pending = gate.pendingApprovals(makeExecution([s1, s2, s3]));
    expect(pending.map((s) => s.id)).toEqual([s1.id]);
  });

  it('builds planner input from approved steps', () => {
    const gate = new ApprovalGate();
    const s1 = makeStep('s1', true, false);
    const s2 = makeStep('s2', true, true);
    const execution = makeExecution([s1, s2]);
    gate.approve('e1', [s1.id]);
    const input = gate.toInput(execution);
    expect(input.approvedIds).toContain(s1.id);
    expect(input.approvedIds).toContain(s2.id);
  });

  it('includes request ids from steps that have them', () => {
    const gate = new ApprovalGate();
    const s1 = makeStep('s1', true, false);
    s1.approvalRequestId = 'req-1';
    const input = gate.toInput(makeExecution([s1]));
    expect(input.requestIds).toEqual({ [s1.id]: 'req-1' });
  });

  it('persists decisions to the execution via the repository', async () => {
    const { InMemoryExecutionRepository } = await import('../repositories/in-memory-repository.js');
    const repository = new InMemoryExecutionRepository();
    const s1 = makeStep('s1', true, false);
    const execution = makeExecution([s1]);
    await repository.saveExecution(execution);
    const gate = new ApprovalGate(repository);
    gate.approve('e1', [s1.id]);
    const saved = await repository.getExecution('e1');
    expect(saved?.steps[0]?.approved).toBe(true);
  });
});

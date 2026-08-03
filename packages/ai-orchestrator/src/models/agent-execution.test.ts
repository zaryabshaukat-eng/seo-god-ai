import { describe, expect, it } from 'vitest';
import { AgentExecutionModel } from './agent-execution.js';

const input = {
  taskId: 'task-1',
  stepId: 'step-a',
  agentId: 'title-writer',
  workflowId: 'workflow-1',
  storeId: 'store-1',
  provider: 'openai',
  model: 'gpt-4o-mini',
  attempt: 2,
};

describe('AgentExecutionModel', () => {
  it('creates a RUNNING record with defaults', () => {
    const now = () => new Date('2026-01-01T00:00:00Z');
    const execution = AgentExecutionModel.create({ ...input, now });
    expect(execution.status).toBe('RUNNING');
    expect(execution.attempt).toBe(2);
    expect(execution.promptTokens).toBe(0);
    expect(execution.error).toBeNull();
    expect(execution.completedAt).toBeNull();
    expect(execution.startedAt).toEqual(now());
    expect(execution.id).toBeTruthy();
  });

  it('completes with tokens, cost, and latency', () => {
    const now = () => new Date('2026-01-01T00:00:01Z');
    const completed = AgentExecutionModel.complete(
      AgentExecutionModel.create(input),
      { promptTokens: 10, completionTokens: 5, totalTokens: 15, costEstimate: 0.01, latencyMs: 20 },
      now,
    );
    expect(completed.status).toBe('COMPLETED');
    expect(completed.totalTokens).toBe(15);
    expect(completed.costEstimate).toBe(0.01);
    expect(completed.completedAt).toEqual(now());
  });

  it('completes with the default clock when none is given', () => {
    const completed = AgentExecutionModel.complete(AgentExecutionModel.create(input), {
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      costEstimate: 0,
      latencyMs: 1,
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).not.toBeNull();
  });

  it('fails with an error message', () => {
    const failed = AgentExecutionModel.fail(AgentExecutionModel.create(input), 'boom');
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toBe('boom');
    expect(failed.completedAt).not.toBeNull();
  });

  it('sets an arbitrary status', () => {
    const cancelled = AgentExecutionModel.setStatus(AgentExecutionModel.create(input), 'CANCELLED');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.completedAt).not.toBeNull();
  });
});

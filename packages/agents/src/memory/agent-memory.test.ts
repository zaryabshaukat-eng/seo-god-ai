import { describe, expect, it } from 'vitest';
import { InMemoryAgentRepository } from '../repositories/agent-repository.js';
import { AgentMemory } from './agent-memory.js';
import { makeResult } from '../test/helpers.js';

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

function makeMemory(now: () => Date = () => FIXED_NOW): { repo: InMemoryAgentRepository; memory: AgentMemory } {
  const repo = new InMemoryAgentRepository();
  return { repo, memory: new AgentMemory(repo, now) };
}

const result = makeResult('metadata', 'task-1', { status: 'PARTIAL' });

describe('AgentMemory', () => {
  it('adds and queries entries', async () => {
    const { memory } = makeMemory();
    await memory.add({
      storeId: 'store-1',
      agentId: 'metadata',
      kind: 'execution',
      key: 'execution:r1',
      data: { runId: 'r1' },
    });
    const found = await memory.query({ storeId: 'store-1' });
    expect(found).toHaveLength(1);
    expect(found[0]?.createdAt).toBe(FIXED_NOW);
  });

  it('latest returns the newest matching entry or null', async () => {
    const { memory } = makeMemory();
    expect(await memory.latest('store-1', 'execution', 'k')).toBeNull();
    await memory.add({
      storeId: 'store-1',
      agentId: 'metadata',
      kind: 'execution',
      key: 'k',
      data: {},
    });
    const entry = await memory.latest('store-1', 'execution', 'k');
    expect(entry?.key).toBe('k');
  });

  it('records history with derived summary data', async () => {
    const { memory } = makeMemory();
    const entry = await memory.recordHistory({ storeId: 'store-1', agentId: 'metadata', workflowId: 'w1', result });
    expect(entry.kind).toBe('agent_history');
    expect(entry.key).toBe('history:task-1');
    expect(entry.data).toMatchObject({ status: 'PARTIAL', ruleIds: [] });
  });

  it('records execution and performance entries', async () => {
    const { memory } = makeMemory();
    const run = {
      id: 'run-1',
      agentId: 'metadata',
      name: 'Metadata Agent',
      version: '1.0.0',
      taskId: 'task-1',
      workflowId: 'w1',
      storeId: 'store-1',
      status: 'SUCCESS' as const,
      startedAt: FIXED_NOW,
      completedAt: FIXED_NOW,
      durationMs: 10,
      tokenEstimate: 100,
      costEstimate: 0.001,
      confidence: 0.9,
      risk: 'LOW' as const,
      recommendationCount: 1,
      actionCount: 0,
    };
    const execution = await memory.recordExecution({ storeId: 'store-1', agentId: 'metadata', run });
    expect(execution.kind).toBe('execution');
    const performance = await memory.recordPerformance({ storeId: 'store-1', agentId: 'metadata', run });
    expect(performance.kind).toBe('performance');
    expect(performance.data).toMatchObject({ runId: 'run-1', confidence: 0.9, tokens: 100 });
  });

  it('records feedback with optional fields omitted', async () => {
    const { repo, memory } = makeMemory();
    const feedback = await memory.recordFeedback({
      storeId: 'store-1',
      agentId: 'metadata',
      taskId: 'task-1',
      workflowId: 'w1',
      rating: 4,
      comment: 'ok',
    });
    expect(feedback.workflowId).toBe('w1');
    expect(feedback.comment).toBe('ok');
    const minimal = await memory.recordFeedback({ storeId: 'store-1', agentId: 'metadata', taskId: 'task-1', rating: 3 });
    expect('comment' in minimal).toBe(false);
    expect(await repo.listFeedback()).toHaveLength(2);
  });

  it('records validation failures', async () => {
    const { repo, memory } = makeMemory();
    const record = await memory.recordValidationFailure({
      storeId: 'store-1',
      agentId: 'metadata',
      taskId: 'task-1',
      failures: [{ code: 'safety', path: '$.actions', message: 'nope' }],
    });
    expect(record.failures).toHaveLength(1);
    expect(await repo.listValidationFailures()).toHaveLength(1);
  });
});

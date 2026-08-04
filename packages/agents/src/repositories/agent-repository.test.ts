import { describe, expect, it } from 'vitest';
import { InMemoryAgentRepository } from './agent-repository.js';
import type { AgentRunRecord, MemoryEntry } from '../types/memory.js';

function run(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: 'run-1',
    agentId: 'metadata',
    name: 'Metadata Agent',
    version: '1.0.0',
    taskId: 'task-1',
    workflowId: 'workflow-1',
    storeId: 'store-1',
    status: 'SUCCESS',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: new Date('2026-01-01T00:00:01.000Z'),
    durationMs: 1000,
    tokenEstimate: 100,
    costEstimate: 0.0002,
    confidence: 0.9,
    risk: 'LOW',
    recommendationCount: 1,
    actionCount: 0,
    ...overrides,
  };
}

function memory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'm1',
    storeId: 'store-1',
    agentId: 'metadata',
    kind: 'execution',
    key: 'execution:run-1',
    data: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('InMemoryAgentRepository', () => {
  it('saves and retrieves runs', async () => {
    const repo = new InMemoryAgentRepository();
    await repo.saveRun(run());
    expect(await repo.getRun('run-1')).toMatchObject({ id: 'run-1' });
    expect(await repo.getRun('missing')).toBeNull();
  });

  it('lists runs filtered and sorted newest first', async () => {
    const repo = new InMemoryAgentRepository();
    await repo.saveRun(run({ id: 'old', storeId: 'store-1', startedAt: new Date(2025) }));
    await repo.saveRun(run({ id: 'new', storeId: 'store-1', startedAt: new Date(2026) }));
    await repo.saveRun(run({ id: 'other', storeId: 'store-2', startedAt: new Date(2026) }));
    const list = await repo.listRuns({ storeId: 'store-1' });
    expect(list.map((entry) => entry.id)).toEqual(['new', 'old']);
    expect(await repo.listRuns()).toHaveLength(3);
  });

  it('queries memory with filters and limit', async () => {
    const repo = new InMemoryAgentRepository();
    await repo.saveMemory(memory({ id: 'a', key: 'k', createdAt: new Date(2026) }));
    await repo.saveMemory(memory({ id: 'b', key: 'k', createdAt: new Date(2027) }));
    await repo.saveMemory(memory({ id: 'c', key: 'other', createdAt: new Date(2026) }));
    const results = await repo.queryMemory({ storeId: 'store-1', agentId: 'metadata', key: 'k', limit: 1 });
    expect(results.map((entry) => entry.id)).toEqual(['b']);
  });

  it('stores and filters feedback', async () => {
    const repo = new InMemoryAgentRepository();
    await repo.saveFeedback({
      id: 'f1',
      storeId: 'store-1',
      agentId: 'metadata',
      taskId: 'task-1',
      rating: 5,
      createdAt: new Date(2026),
    });
    const list = await repo.listFeedback({ storeId: 'store-1' });
    expect(list).toHaveLength(1);
    expect(await repo.listFeedback({ storeId: 'nope' })).toHaveLength(0);
  });

  it('stores and filters validation failures', async () => {
    const repo = new InMemoryAgentRepository();
    await repo.saveValidationFailure({
      id: 'v1',
      storeId: 'store-1',
      agentId: 'metadata',
      taskId: 'task-1',
      failures: [{ code: 'structure', path: '$.x', message: 'bad' }],
      createdAt: new Date(2026),
    });
    const list = await repo.listValidationFailures({ agentId: 'metadata' });
    expect(list).toHaveLength(1);
  });

  it('computes an empty performance snapshot', async () => {
    const repo = new InMemoryAgentRepository();
    const snapshot = await repo.performanceSnapshot({ storeId: 'store-1', agentId: 'metadata' });
    expect(snapshot).toEqual({ runs: 0, averageConfidence: 0, averageTokens: 0, estimatedCost: 0 });
  });

  it('computes averages and total cost across runs', async () => {
    const repo = new InMemoryAgentRepository();
    await repo.saveRun(run({ id: 'a', confidence: 0.8, tokenEstimate: 100, costEstimate: 0.1 }));
    await repo.saveRun(run({ id: 'b', confidence: 0.9, tokenEstimate: 300, costEstimate: 0.3 }));
    const snapshot = await repo.performanceSnapshot({ storeId: 'store-1', agentId: 'metadata' });
    expect(snapshot.runs).toBe(2);
    expect(snapshot.averageConfidence).toBeCloseTo(0.85);
    expect(snapshot.averageTokens).toBe(200);
    expect(snapshot.estimatedCost).toBeCloseTo(0.4);
  });
});

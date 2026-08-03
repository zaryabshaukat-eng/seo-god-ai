import { NotFoundError } from '@seogod/core';
import { describe, expect, it } from 'vitest';
import { InMemoryOrchestratorRepository } from './in-memory-repository.js';
import { WorkflowExecutionModel } from '../models/workflow-execution.js';
import { ExecutionTraceModel } from '../models/execution-trace.js';
import { workflowDefinition } from '../test/fixtures.js';
import type { MemoryEntry } from '../types/memory.js';

describe('InMemoryOrchestratorRepository', () => {
  it('saves and loads workflow definitions', async () => {
    const repository = new InMemoryOrchestratorRepository();
    await repository.saveWorkflowDefinition(workflowDefinition({ id: 'def-1' }));
    expect(await repository.getWorkflowDefinition('def-1')).toMatchObject({ id: 'def-1' });
    expect(await repository.getWorkflowDefinition('missing')).toBeNull();
  });

  it('saves, loads, and lists executions newest-first', async () => {
    const repository = new InMemoryOrchestratorRepository();
    const make = (id: string, storeId: string, at: string) =>
      WorkflowExecutionModel.create({
        definition: workflowDefinition({ id }),
        storeId,
        inputs: {},
        now: () => new Date(at),
      });
    await repository.saveExecution(make('def-1', 'store-1', '2026-01-01T00:00:01Z'));
    await repository.saveExecution(make('def-2', 'store-1', '2026-01-01T00:00:02Z'));
    await repository.saveExecution(make('def-3', 'store-2', '2026-01-01T00:00:03Z'));

    const all = await repository.listExecutions();
    expect(all.map((e) => e.definitionId)).toEqual(['def-3', 'def-2', 'def-1']);
    const store1 = await repository.listExecutions('store-1');
    expect(store1.map((e) => e.definitionId)).toEqual(['def-2', 'def-1']);
    const limited = await repository.listExecutions(undefined, 1);
    expect(limited).toHaveLength(1);
  });

  it('saves and loads traces keyed by execution id', async () => {
    const repository = new InMemoryOrchestratorRepository();
    await repository.saveTrace(ExecutionTraceModel.create('exec-1'));
    expect(await repository.getTrace('exec-1')).toMatchObject({ executionId: 'exec-1' });
    expect(await repository.getTrace('missing')).toBeNull();
  });

  it('stores and queries memory entries', async () => {
    const repository = new InMemoryOrchestratorRepository();
    const entry: MemoryEntry = {
      id: 'm1',
      storeId: 'store-1',
      agentId: 'a',
      kind: 'validation',
      key: 'k1',
      data: { issues: [] },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    await repository.addMemory(entry);
    expect(await repository.queryMemory({ storeId: 'store-1', kind: 'validation' })).toHaveLength(1);
    expect(await repository.queryMemory({ storeId: 'other' })).toHaveLength(0);
  });

  it('falls back to the stored execution when no checkpoint exists', async () => {
    const repository = new InMemoryOrchestratorRepository();
    const execution = WorkflowExecutionModel.create({
      definition: workflowDefinition({ id: 'def-1' }),
      storeId: 'store-1',
      inputs: {},
    });
    await repository.saveExecution(execution);
    expect(await repository.getCheckpoint('missing')).toBeNull();
    const fromExecution = await repository.getCheckpoint(execution.id);
    expect(fromExecution?.checkpointedAt).toBeNull();

    execution.checkpointedAt = new Date('2026-01-01T00:00:00Z');
    await repository.saveCheckpoint(execution);
    const fromCheckpoint = await repository.getCheckpoint(execution.id);
    expect(fromCheckpoint?.checkpointedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('requireExecution throws for unknown executions', async () => {
    const repository = new InMemoryOrchestratorRepository();
    await expect(repository.requireExecution('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('requireExecution returns a stored execution', async () => {
    const repository = new InMemoryOrchestratorRepository();
    const execution = WorkflowExecutionModel.create({
      definition: workflowDefinition({ id: 'def-1' }),
      storeId: 'store-1',
      inputs: {},
    });
    await repository.saveExecution(execution);
    expect((await repository.requireExecution(execution.id)).id).toBe(execution.id);
  });
});

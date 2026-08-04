import { describe, expect, it } from 'vitest';
import type { Execution, ExecutionBatch, ExecutionStep } from '../types/execution.js';
import { buildExecution, buildStep } from '../models/execution.js';
import { buildRollbackRecord } from '../models/rollback.js';
import { InMemoryExecutionRepository } from './in-memory-repository.js';

function makeStep(_id: string): ExecutionStep {
  return buildStep({
    executionId: 'e1', batchId: 'b1', storeId: 's1', actionType: 'update_title',
    resourceType: 'product', resourceId: 'p1', payload: { title: 'x' }, order: 0,
  });
}

function makeExecution(id: string, mode: Execution['mode'] = 'STAGING'): Execution {
  return buildExecution({
    id, storeId: 's1', mode, source: 'plan', steps: [], batches: [],
  });
}

describe('InMemoryExecutionRepository', () => {
  it('saves and loads executions', async () => {
    const repo = new InMemoryExecutionRepository();
    const execution = makeExecution('e1');
    await repo.saveExecution(execution);
    expect((await repo.getExecution('e1'))?.id).toBe('e1');
    expect(await repo.getExecution('missing')).toBeNull();
  });

  it('filters executions by store, status and mode', async () => {
    const repo = new InMemoryExecutionRepository();
    const a = makeExecution('a', 'DRY_RUN');
    const b = makeExecution('b', 'STAGING');
    b.storeId = 's2';
    await repo.saveExecution(a);
    await repo.saveExecution(b);
    expect(await repo.listExecutions({ storeId: 's2' })).toHaveLength(1);
    expect(await repo.listExecutions({ status: 'PENDING' })).toHaveLength(2);
    expect(await repo.listExecutions({ mode: 'STAGING' })).toHaveLength(1);
    expect(await repo.listExecutions()).toHaveLength(2);
  });

  it('saves and loads steps, batches, diffs and rollbacks', async () => {
    const repo = new InMemoryExecutionRepository();
    const step = makeStep('step-1');
    await repo.saveStep(step);
    expect((await repo.getStep(step.id))?.id).toBe(step.id);
    expect(await repo.getStep('missing')).toBeNull();

    const batch: ExecutionBatch = {
      id: 'b1', executionId: 'e1', storeId: 's1', resourceType: 'product',
      actionType: 'update_title', stepIds: [step.id], order: 0, status: 'PENDING',
      apiCalls: 0, createdAt: new Date(), updatedAt: new Date(),
    };
    await repo.saveBatch(batch);

    const diff = {
      id: 'd1', executionId: 'e1', stepId: step.id, storeId: 's1',
      resourceType: 'product', resourceId: 'p1', actionType: 'update_title',
      entityId: 'p1', changedFields: ['title'], changes: [], summary: '',
      before: {}, after: {}, hasChanges: false, createdAt: new Date(),
    };
    await repo.saveDiff(diff);
    expect((await repo.getDiff('d1'))?.entityId).toBe('p1');
    expect(await repo.getDiff('missing')).toBeNull();

    const rollback = buildRollbackRecord({
      executionId: 'e1', storeId: 's1', scope: 'single', mode: 'STAGING', reason: 'test',
    });
    await repo.saveRollback(rollback);
    expect((await repo.getRollback(rollback.id))?.scope).toBe('single');
    expect(await repo.getRollback('missing')).toBeNull();
  });

  it('appends and accumulates history entries', async () => {
    const repo = new InMemoryExecutionRepository();
    await repo.appendHistory('e1', { at: new Date(), event: 'execution.started', detail: null });
    await repo.appendHistory('e1', { at: new Date(), event: 'execution.completed', detail: null });
    const history = repo['history'].get('e1');
    expect(history).toHaveLength(2);
  });

  it('saves and loads metrics', async () => {
    const repo = new InMemoryExecutionRepository();
    const metrics = {
      executionId: 'e1', startedAt: new Date(), completedAt: new Date(),
      durationMs: 10, apiCalls: 2, rollbacks: 0, steps: { total: 1, completed: 1, failed: 0 },
    };
    await repo.saveMetrics('e1', metrics as never);
    expect((await repo.getMetrics('e1'))?.apiCalls).toBe(2);
    expect(await repo.getMetrics('missing')).toBeNull();
  });

  it('finds the most recent completed step for a store/resource/action', async () => {
    const repo = new InMemoryExecutionRepository();
    const completed = makeStep('done-1');
    completed.status = 'COMPLETED';
    const pending = makeStep('pending-1');
    await repo.saveStep(pending);
    await repo.saveStep(completed);
    const found = await repo.findCompletedStep('s1', 'product', 'p1', 'update_title');
    expect(found?.id).toBe(completed.id);
  });

  it('finds simulated steps for a store/resource/action', async () => {
    const repo = new InMemoryExecutionRepository();
    const simulated = makeStep('sim-1');
    simulated.id = 'sim-1';
    simulated.status = 'SIMULATED';
    await repo.saveStep(simulated);
    const found = await repo.findCompletedStep('s1', 'product', 'p1', 'update_title');
    expect(found?.id).toBe('sim-1');
  });

  it('lists active executions', async () => {
    const repo = new InMemoryExecutionRepository();
    const pending = makeExecution('pending');
    const executing = makeExecution('executing');
    executing.status = 'EXECUTING';
    const done = makeExecution('done');
    done.status = 'COMPLETED';
    await repo.saveExecution(pending);
    await repo.saveExecution(executing);
    await repo.saveExecution(done);
    expect(await repo.listActiveExecutions()).toHaveLength(2);
    expect(await repo.listActiveExecutions('s1')).toHaveLength(2);
    expect(await repo.listActiveExecutions('other')).toHaveLength(0);
  });
});

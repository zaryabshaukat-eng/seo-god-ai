import { describe, expect, it } from 'vitest';
import { normalizeSafetyConfig } from '../safety/config.js';
import { ExecutionService } from './execution-service.js';

const NO_APPROVAL = normalizeSafetyConfig({ requireApproval: false });

describe('ExecutionService', () => {
  it('builds a fully-wired engine from defaults', async () => {
    const service = new ExecutionService({ config: NO_APPROVAL });
    const execution = await service.execute(
      { storeId: 's1', mode: 'DRY_RUN', actions: [{ actionType: 'update_title', resourceType: 'product', resourceId: 'p1', payload: { title: 'New' } }] },
      { shopDomain: 'shop.example.com' },
    );
    expect(execution.status).toBe('COMPLETED');
  });

  it('executes real-mode writes through the default memory writer', async () => {
    const service = new ExecutionService({ config: NO_APPROVAL });
    const execution = await service.execute(
      { storeId: 's1', mode: 'STAGING', actions: [{ actionType: 'update_title', resourceType: 'product', resourceId: 'p1', payload: { title: 'New' } }] },
      { shopDomain: 'shop.example.com' },
    );
    expect(execution.steps[0]?.status).toBe('COMPLETED');
  });

  it('lists and fetches executions from the repository', async () => {
    const service = new ExecutionService({ config: NO_APPROVAL });
    const execution = await service.execute(
      { storeId: 's1', mode: 'DRY_RUN', actions: [{ actionType: 'update_title', resourceType: 'product', resourceId: 'p1', payload: { title: 'New' } }] },
    );
    expect((await service.getExecution(execution.id))?.id).toBe(execution.id);
    expect(await service.listExecutions({ storeId: 's1' })).toHaveLength(1);
  });

  it('builds an audit report with metrics and diffs', async () => {
    const service = new ExecutionService({ config: NO_APPROVAL });
    const execution = await service.execute(
      { storeId: 's1', mode: 'STAGING', actions: [{ actionType: 'update_title', resourceType: 'product', resourceId: 'p1', payload: { title: 'New' } }] },
      { shopDomain: 'shop.example.com' },
    );
    const report = await service.report(execution.id);
    expect(report?.execution.id).toBe(execution.id);
    expect(report?.diffs).toHaveLength(1);
    expect(report?.metrics).not.toBeNull();
    expect(await service.report('missing')).toBeNull();
  });

  it('forwards approval, resume and cancel to the engine', async () => {
    const service = new ExecutionService({
      config: normalizeSafetyConfig({ requireApproval: true }),
    });
    const execution = await service.execute(
      { storeId: 's1', mode: 'DRY_RUN', actions: [{ actionType: 'update_title', resourceType: 'product', resourceId: 'p1', payload: { title: 'New' } }] },
    );
    expect(execution.status).toBe('PENDING');
    expect(await service.cancel(execution.id)).toBe(true);
  });

  it('approves a pending execution and resumes it to completion', async () => {
    const service = new ExecutionService({
      config: normalizeSafetyConfig({ requireApproval: true }),
    });
    const execution = await service.execute(
      { storeId: 's1', mode: 'DRY_RUN', actions: [{ actionType: 'update_title', resourceType: 'product', resourceId: 'p1', payload: { title: 'New' } }] },
    );
    expect(execution.status).toBe('PENDING');
    const approved = await service.approve(execution.id, execution.steps.map((s) => s.id));
    expect(approved).not.toBeNull();
    const resumed = await service.resume(execution.id, 'shop.example.com');
    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.steps[0]?.status).toBe('SIMULATED');
  });
});

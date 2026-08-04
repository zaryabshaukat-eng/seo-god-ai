import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '@seogod/monitoring';
import type { ApprovedActionInput } from '../types/plan.js';
import { ExecutionPlanner } from '../planner/execution-planner.js';
import { OperationPublisher } from '../publisher/publisher.js';
import { MemoryShopifyWriter } from '../publisher/shopify-writer.js';
import { InMemoryExecutionRepository } from '../repositories/in-memory-repository.js';
import { RollbackEngine } from '../rollback/engine.js';
import { SafetyGuard } from '../safety/safety-guard.js';
import { normalizeSafetyConfig } from '../safety/config.js';
import { RateLimiter } from '../safety/rate-limiter.js';
import { InMemorySink } from '../monitoring/event-publisher.js';
import { InMemoryQueueStore } from '../queue/queue-store.js';
import { ExecutionWorker } from '../workers/execution-worker.js';
import { StoreLock } from '../safety/store-lock.js';
import {
  ExecutionError,
  ExecutionErrorCodes,
  InvalidExecutionError,
  SafetyViolationError,
  StoreLockedError,
} from '../utils/errors.js';
import { defaultChecks } from '../validators/validation-pipeline.js';
import { ExecutionEngine } from './execution-engine.js';

function action(overrides: Partial<ApprovedActionInput> = {}): ApprovedActionInput {
  return {
    actionType: 'update_title',
    resourceType: 'product',
    resourceId: 'p1',
    resourceRef: 'products/p1',
    payload: { title: 'New Title' },
    ...overrides,
  };
}

function makeEngine(overrides: {
  config?: ReturnType<typeof normalizeSafetyConfig>;
  writer?: MemoryShopifyWriter;
  worker?: ExecutionWorker;
  publisher?: OperationPublisher;
  safety?: SafetyGuard;
  metricsRegistry?: MetricsRegistry;
  repository?: InMemoryExecutionRepository;
} = {}) {
  const writer = overrides.writer ?? new MemoryShopifyWriter();
  const publisher = overrides.publisher ?? new OperationPublisher({ writer });
  const config = overrides.config ?? normalizeSafetyConfig({ requireApproval: false });
  const safety = overrides.safety ?? new SafetyGuard({ config });
  const repository = overrides.repository ?? new InMemoryExecutionRepository();
  const rollback = new RollbackEngine({ publisher });
  const planner = new ExecutionPlanner({ registry: publisher.getRegistry(), config });
  const sink = new InMemorySink();
  const engine = new ExecutionEngine({
    planner,
    publisher,
    safety,
    rollback,
    config,
    repository,
    eventSink: sink,
    validators: defaultChecks(),
    worker: overrides.worker,
    resourceStateProvider: async () => ({ title: 'Old Title' }),
    metricsRegistry: overrides.metricsRegistry,
  });
  return { engine, writer, safety, repository, sink, publisher, planner };
}

describe('ExecutionEngine', () => {
  it('runs a dry-run execution inline without writing', async () => {
    const { engine, writer, repository } = makeEngine();
    const execution = await engine.execute(
      { storeId: 's1', mode: 'DRY_RUN', actions: [action()] },
      { shopDomain: 'shop.example.com' },
    );
    expect(execution.status).toBe('COMPLETED');
    expect(execution.steps[0]?.status).toBe('SIMULATED');
    expect(writer.calls).toHaveLength(0);
    expect(await repository.getMetrics(execution.id)).not.toBeNull();
  });

  it('writes to the store in a real mode and completes', async () => {
    const { engine, writer, repository, sink } = makeEngine();
    const execution = await engine.execute(
      { storeId: 's1', mode: 'STAGING', actions: [action()] },
      { shopDomain: 'shop.example.com' },
    );
    expect(execution.status).toBe('COMPLETED');
    expect(execution.steps[0]?.status).toBe('COMPLETED');
    expect(execution.steps[0]?.apiCalls).toBe(1);
    expect(writer.calls).toHaveLength(1);
    expect(sink.eventsOf('execution.completed')).toHaveLength(1);
    expect(sink.eventsOf('execution.started')).toHaveLength(1);
    const saved = await repository.getExecution(execution.id);
    expect(saved?.summary.completed).toBe(1);
  });

  it('releases the store lock after a real-mode run', async () => {
    const { engine, safety } = makeEngine();
    const execution = await engine.execute(
      { storeId: 's1', mode: 'PRODUCTION', actions: [action()] },
      { shopDomain: 'shop.example.com' },
    );
    expect(execution.status).toBe('COMPLETED');
    expect(safety.storeLock.owner('s1')).toBeNull();
  });

  it('returns PENDING when approval is required, then runs after approval', async () => {
    const config = normalizeSafetyConfig({ requireApproval: true });
    const { engine, repository } = makeEngine({ config });
    const pending = await engine.execute(
      { storeId: 's1', mode: 'STAGING', actions: [action()] },
      { shopDomain: 'shop.example.com' },
    );
    expect(pending.status).toBe('PENDING');
    expect(pending.steps[0]?.approved).toBe(false);

    const approved = await engine.approve(pending.id, [pending.steps[0]!.id]);
    expect(approved?.steps[0]?.approved).toBe(true);

    const resumed = await engine.resume(pending.id, 'shop.example.com');
    expect(resumed.status).toBe('COMPLETED');
    const saved = await repository.getExecution(pending.id);
    expect(saved?.steps[0]?.status).toBe('COMPLETED');
  });

  it('throws when queue submission is requested without a worker', async () => {
    const { engine } = makeEngine();
    await expect(
      engine.execute({ storeId: 's1', mode: 'DRY_RUN', actions: [action()] }, { submit: 'queue' }),
    ).rejects.toThrow(InvalidExecutionError);
  });

  it('queues an execution when a worker is configured', async () => {
    const queue = new InMemoryQueueStore<{ executionId: string }>();
    const worker = new ExecutionWorker({ queue, handler: async () => {} });
    const { engine } = makeEngine({ worker });
    const execution = await engine.execute(
      { storeId: 's1', mode: 'DRY_RUN', actions: [action()] },
      { submit: 'queue' },
    );
    expect(execution.status).toBe('QUEUED');
    expect(queue.size()).toBe(1);
    const entries = await queue.list();
    expect(entries[0]?.payload.executionId).toBe(execution.id);
  });

  it('cancels a pending execution', async () => {
    const config = normalizeSafetyConfig({ requireApproval: true });
    const { engine } = makeEngine({ config });
    const pending = await engine.execute({ storeId: 's1', mode: 'STAGING', actions: [action()] });
    expect(pending.status).toBe('PENDING');
    expect(await engine.cancel(pending.id)).toBe(true);
    expect((await engine.executionRepository.getExecution(pending.id))?.status).toBe('CANCELLED');
  });

  it('rejects an execution that violates the safety model', async () => {
    const { engine, sink } = makeEngine({ config: normalizeSafetyConfig({ requireApproval: false, allowedModes: ['DRY_RUN'] }) });
    await expect(
      engine.execute({ storeId: 's1', mode: 'PRODUCTION', actions: [action()] }),
    ).rejects.toThrow();
    const executions = await engine.executionRepository.listExecutions();
    expect(executions[0]?.status).toBe('REJECTED');
    expect(sink.eventsOf('execution.safety_violation')).toHaveLength(1);
  });

  it('rejects a run when another execution holds the store lock', async () => {
    const { engine, safety } = makeEngine();
    safety.storeLock.acquire('s1', 'other-exec');
    await expect(
      engine.execute({ storeId: 's1', mode: 'PRODUCTION', actions: [action()] }),
    ).rejects.toThrow(SafetyViolationError);
    const executions = await engine.executionRepository.listExecutions();
    expect(executions[0]?.status).toBe('REJECTED');
  });

  it('rolls back completed steps when a later step fails', async () => {
    const { engine, repository, planner } = makeEngine();
    const planned = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      actions: [action({ resourceId: 'p1' }), action({ resourceId: 'p2' })],
    });
    planned.steps[1]!.rollbackPlan = null;
    await repository.saveExecution(planned);
    const execution = await engine.resume(planned.id, 'shop.example.com');
    expect(execution.status).toBe('ROLLED_BACK');
    expect(execution.steps[0]?.status).toBe('ROLLED_BACK');
    expect(execution.steps[1]?.status).toBe('FAILED');
    const rollbacks = await repository.listExecutions();
    expect(rollbacks).toHaveLength(1);
  });

  it('emits rollback events when auto-rollback runs', async () => {
    const { engine, repository, planner, sink } = makeEngine();
    const planned = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      actions: [action({ resourceId: 'p1' })],
    });
    planned.steps[0]!.rollbackPlan = null;
    await repository.saveExecution(planned);
    await engine.resume(planned.id, 'shop.example.com');
    expect(sink.eventsOf('execution.rollback_started')).toHaveLength(1);
    expect(sink.eventsOf('execution.rollback_completed')).toHaveLength(1);
  });

  it('cancels remaining steps and fails the execution when auto-rollback is disabled', async () => {
    const config = normalizeSafetyConfig({ requireApproval: false, autoRollbackOnFailure: false });
    const { engine, repository, planner } = makeEngine({ config });
    const planned = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      actions: [action({ resourceId: 'p1' }), action({ resourceId: 'p2' })],
    });
    planned.steps[1]!.rollbackPlan = null;
    await repository.saveExecution(planned);
    const execution = await engine.resume(planned.id, 'shop.example.com');
    expect(execution.status).toBe('FAILED');
    expect(execution.steps[0]?.status).toBe('COMPLETED');
    expect(execution.steps[1]?.status).toBe('FAILED');
  });

  it('persists diffs and batches to the repository', async () => {
    const { engine, repository } = makeEngine();
    const execution = await engine.execute(
      { storeId: 's1', mode: 'STAGING', actions: [action()] },
      { shopDomain: 'shop.example.com' },
    );
    const diff = await repository.getDiff(execution.steps[0]!.diffId!);
    expect(diff?.changedFields).toContain('title');
    const batch = await repository.getExecution(execution.id);
    expect(batch?.batches[0]?.status).toBe('COMPLETED');
  });

  it('falls back to default config, repository, sink and metrics when omitted', async () => {
    const writer = new MemoryShopifyWriter();
    const publisher = new OperationPublisher({ writer });
    const safety = new SafetyGuard();
    const rollback = new RollbackEngine({ publisher });
    const planner = new ExecutionPlanner({ registry: publisher.getRegistry() });
    const engine = new ExecutionEngine({ planner, publisher, safety, rollback });
    const pending = await engine.execute({ storeId: 's1', mode: 'DRY_RUN', actions: [action()] });
    expect(pending.status).toBe('PENDING');
    await engine.approve(pending.id, [pending.steps[0]!.id]);
    const completed = await engine.resume(pending.id);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.steps[0]?.status).toBe('SIMULATED');
  });

  it('exposes accessors and lifecycle methods', async () => {
    const { engine, safety } = makeEngine();
    expect(engine.safetyGuard).toBe(safety);
    expect(engine.publisherOf).toBeDefined();
    engine.emergencyStop('s1');
    engine.resumeFromStop('s1');
    engine.start();
    await engine.stop();
  });

  it('throws when resuming an unknown execution', async () => {
    const { engine } = makeEngine();
    await expect(engine.resume('missing-execution')).rejects.toThrow(InvalidExecutionError);
  });

  it('returns false when cancelling unknown or finished executions', async () => {
    const { engine } = makeEngine();
    expect(await engine.cancel('missing-execution')).toBe(false);
    const done = await engine.execute(
      { storeId: 's1', mode: 'DRY_RUN', actions: [action()] },
      { shopDomain: 'shop.example.com' },
    );
    expect(await engine.cancel(done.id)).toBe(false);
  });

  it('cancels READY steps of a pending execution', async () => {
    const config = normalizeSafetyConfig({ requireApproval: true });
    const { engine, repository } = makeEngine({ config });
    const pending = await engine.execute({ storeId: 's1', mode: 'STAGING', actions: [action()] });
    const stored = (await repository.getExecution(pending.id))!;
    stored.steps[0]!.status = 'READY';
    await repository.saveExecution(stored);
    expect(await engine.cancel(pending.id)).toBe(true);
    const cancelled = (await repository.getExecution(pending.id))!;
    expect(cancelled.steps[0]?.status).toBe('CANCELLED');
  });

  it('throws StoreLockedError when the store lock cannot be acquired', async () => {
    class OccupiedLock extends StoreLock {
      override acquire(_storeId: string, _executionId: string): boolean {
        return false;
      }

      override owner(_storeId: string): string | null {
        return null;
      }
    }
    const writer = new MemoryShopifyWriter();
    const publisher = new OperationPublisher({ writer });
    const config = normalizeSafetyConfig({ requireApproval: false });
    const safety = new SafetyGuard({ config, storeLock: new OccupiedLock() });
    const rollback = new RollbackEngine({ publisher });
    const planner = new ExecutionPlanner({ registry: publisher.getRegistry(), config });
    const engine = new ExecutionEngine({ planner, publisher, safety, rollback, config });
    await expect(
      engine.execute({ storeId: 's1', mode: 'PRODUCTION', actions: [action()] }, { shopDomain: 'x' }),
    ).rejects.toThrow(StoreLockedError);
  });

  it('wraps unexpected failures and marks the execution failed', async () => {
    const { engine, repository, planner, sink } = makeEngine();
    const planned = planner.plan({ storeId: 's1', mode: 'STAGING', actions: [action()] });
    await repository.saveExecution(planned);
    let metricCalls = 0;
    repository.saveMetrics = async () => {
      metricCalls += 1;
      if (metricCalls === 1) throw new Error('metrics db down');
    };
    await expect(engine.resume(planned.id, 'shop.example.com')).rejects.toThrow(ExecutionError);
    const saved = await repository.getExecution(planned.id);
    expect(saved?.status).toBe('FAILED');
    expect(sink.eventsOf('execution.failed')).toHaveLength(1);
  });

  it('marks a step FAILED and emits rollback_failed when restoring fails', async () => {
    const writer = new MemoryShopifyWriter();
    const realUpdateProduct = writer.updateProduct.bind(writer);
    let writerCalls = 0;
    writer.updateProduct = async (shopDomain, input) => {
      writerCalls += 1;
      if (writerCalls === 2) throw new Error('restore failed');
      return realUpdateProduct(shopDomain, input);
    };
    const { engine, repository, planner, sink } = makeEngine({ writer });
    const planned = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      actions: [action({ resourceId: 'p1' }), action({ resourceId: 'p2' })],
    });
    planned.steps[0]!.rollbackPlan = {
      available: true,
      reason: undefined,
      steps: [{ action: 'restore_field', resourceType: 'product', resourceId: 'p1', payload: { field: 'title', value: 'Old' } }],
    };
    planned.steps[1]!.rollbackPlan = null;
    await repository.saveExecution(planned);
    const execution = await engine.resume(planned.id, 'shop.example.com');
    expect(execution.status).toBe('ROLLED_BACK');
    expect(execution.steps[0]?.status).toBe('FAILED');
    expect(sink.eventsOf('execution.rollback_failed')).toHaveLength(1);
  });

  it('skips pre-skipped steps and classifies crafted batch states', async () => {
    const { engine, repository, planner } = makeEngine();
    const planned = planner.plan({
      storeId: 's1',
      mode: 'DRY_RUN',
      actions: [action({ resourceId: 'p1' }), action({ resourceId: 'p2' }), action({ resourceId: 'p3' })],
    });
    const [s1, s2, s3] = planned.steps;
    s1!.status = 'SKIPPED';
    s2!.status = 'COMPLETED';
    s3!.status = 'CANCELLED';
    const base = planned.batches[0]!;
    planned.batches = [
      { ...base, id: 'b-ghost', stepIds: ['ghost-id'] },
      { ...base, id: 'b-skipped', stepIds: [s1!.id] },
      { ...base, id: 'b-mixed-cancel', stepIds: [s1!.id, s3!.id] },
      { ...base, id: 'b-mixed-exec', stepIds: [s2!.id, s1!.id] },
    ];
    await repository.saveExecution(planned);
    const execution = await engine.resume(planned.id, 'shop.example.com');
    const batches = execution.batches;
    expect(batches.find((b) => b.id === 'b-ghost')?.status).toBe('CANCELLED');
    expect(batches.find((b) => b.id === 'b-skipped')?.status).toBe('SKIPPED');
    expect(batches.find((b) => b.id === 'b-mixed-cancel')?.status).toBe('CANCELLED');
    expect(batches.find((b) => b.id === 'b-mixed-exec')?.status).toBe('EXECUTING');
  });

  it('approve only marks the requested steps', async () => {
    const config = normalizeSafetyConfig({ requireApproval: true });
    const { engine } = makeEngine({ config });
    const pending = await engine.execute({
      storeId: 's1',
      mode: 'STAGING',
      actions: [action({ resourceId: 'p1' }), action({ resourceId: 'p2' })],
    });
    await engine.approve(pending.id, ['not-a-step']);
    expect(pending.steps[0]?.approved).toBe(false);
    await engine.approve(pending.id, [pending.steps[0]!.id]);
    expect(pending.steps[0]?.approved).toBe(true);
    expect(pending.steps[1]?.approved).toBe(false);
  });

  it('cancels a READY remaining step when auto-rollback is disabled', async () => {
    const config = normalizeSafetyConfig({ requireApproval: false, autoRollbackOnFailure: false });
    const { engine, repository, planner } = makeEngine({ config });
    const planned = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      actions: [action({ resourceId: 'p1' }), action({ resourceId: 'p2' }), action({ resourceId: 'p3' })],
    });
    planned.steps[1]!.rollbackPlan = null;
    planned.steps[2]!.status = 'READY';
    await repository.saveExecution(planned);
    const execution = await engine.resume(planned.id, 'shop.example.com');
    expect(execution.status).toBe('FAILED');
    expect(execution.steps[2]?.status).toBe('CANCELLED');
  });

  it('returns null when approving an unknown execution', async () => {
    const { engine } = makeEngine();
    expect(await engine.approve('missing-execution', ['s1'])).toBeNull();
  });

  it('starts and stops the configured worker', async () => {
    const queue = new InMemoryQueueStore<{ executionId: string }>();
    const worker = new ExecutionWorker({ queue, handler: async () => {} });
    const { engine } = makeEngine({ worker });
    engine.start();
    expect(worker.isRunning()).toBe(true);
    await engine.stop();
    expect(worker.isRunning()).toBe(false);
  });

  it('rejects with a string safety violation message', async () => {
    class ThrowingSafety extends SafetyGuard {
      override assertCanExecute(): void {
        throw 'safety stop';
      }
    }
    const { engine, sink } = makeEngine({ safety: new ThrowingSafety() });
    await expect(
      engine.execute({ storeId: 's1', mode: 'DRY_RUN', actions: [action()] }),
    ).rejects.toThrow('safety stop');
    const executions = await engine.executionRepository.listExecutions();
    expect(executions[0]?.status).toBe('REJECTED');
    expect(sink.eventsOf('execution.safety_violation')).toHaveLength(1);
  });

  it('wraps a non-Error failure from finalization', async () => {
    const { engine, repository, planner } = makeEngine();
    const planned = planner.plan({ storeId: 's1', mode: 'STAGING', actions: [action()] });
    await repository.saveExecution(planned);
    let metricCalls = 0;
    repository.saveMetrics = async () => {
      metricCalls += 1;
      if (metricCalls === 1) throw 'metrics db down';
    };
    await expect(engine.resume(planned.id, 'shop.example.com')).rejects.toThrow(ExecutionError);
    const saved = await repository.getExecution(planned.id);
    expect(saved?.status).toBe('FAILED');
  });

  it('rethrows ExecutionErrors raised during finalization', async () => {
    const { engine, repository, planner } = makeEngine();
    const planned = planner.plan({ storeId: 's1', mode: 'STAGING', actions: [action()] });
    await repository.saveExecution(planned);
    const boom = new ExecutionError('metrics exploded', ExecutionErrorCodes.execution);
    let metricCalls = 0;
    repository.saveMetrics = async () => {
      metricCalls += 1;
      if (metricCalls === 1) throw boom;
    };
    await expect(engine.resume(planned.id, 'shop.example.com')).rejects.toBe(boom);
  });

  it('fails the step and cancels the rest when diff persistence throws', async () => {
    const { engine, repository, planner } = makeEngine();
    const planned = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      actions: [action({ resourceId: 'p1' }), action({ resourceId: 'p2' })],
    });
    await repository.saveExecution(planned);
    repository.saveDiff = async () => {
      throw 'diff boom';
    };
    const execution = await engine.resume(planned.id, 'shop.example.com');
    expect(execution.status).toBe('ROLLED_BACK');
    expect(execution.steps[0]?.status).toBe('FAILED');
    expect(execution.steps[0]?.error).toBe('diff boom');
    expect(execution.steps[1]?.status).toBe('CANCELLED');
  });

  it('emits a publisher_failed event when the rate limiter blocks a write', async () => {
    const limiter = new RateLimiter({ perMinute: 1 });
    limiter.consume('s1', 1);
    const publisher = new OperationPublisher({
      writer: new MemoryShopifyWriter(),
      rateLimiter: limiter,
      maxWaitMs: 10,
    });
    const { engine, sink } = makeEngine({ publisher });
    const execution = await engine.execute(
      { storeId: 's1', mode: 'STAGING', actions: [action()] },
      { shopDomain: 'shop.example.com' },
    );
    expect(execution.steps[0]?.status).toBe('FAILED');
    expect(sink.eventsOf('execution.publisher_failed')).toHaveLength(1);
  });

  it('records execution metrics through the configured registry', async () => {
    const metrics = new MetricsRegistry();
    const { engine } = makeEngine({ metricsRegistry: metrics });
    const execution = await engine.execute(
      { storeId: 's1', mode: 'DRY_RUN', actions: [action()] },
      { shopDomain: 'shop.example.com' },
    );
    expect(execution.status).toBe('COMPLETED');
    expect(metrics.snapshot().counters['execution.DRY_RUN.COMPLETED']).toBe(1);
  });
});

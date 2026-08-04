import { describe, expect, it } from 'vitest';
import type { Execution, ExecutionStep } from '../types/execution.js';
import { buildExecution, buildStep } from '../models/execution.js';
import { OperationPublisher } from '../publisher/publisher.js';
import { MemoryShopifyWriter } from '../publisher/shopify-writer.js';
import { SafetyGuard } from '../safety/safety-guard.js';
import { normalizeSafetyConfig } from '../safety/config.js';
import { InvalidExecutionError } from '../utils/errors.js';
import { defaultChecks, ValidationPipeline } from '../validators/validation-pipeline.js';
import { buildValidationContext, StepRunner } from './step-runner.js';

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  const built = buildStep({
    executionId: 'e1',
    batchId: 'b1',
    storeId: 's1',
    actionType: 'update_title',
    resourceType: 'product',
    resourceId: 'p1',
    payload: { title: 'New Title' },
    order: 0,
  });
  return { ...built, ...overrides };
}

function makeExecution(steps: ExecutionStep[], mode: Execution['mode'] = 'STAGING'): Execution {
  return buildExecution({
    id: 'e1',
    storeId: 's1',
    mode,
    source: 'plan',
    steps,
    batches: [],
  });
}

function runner(overrides: { config?: Parameters<typeof normalizeSafetyConfig>[0]; resourceState?: Record<string, unknown> | null } = {}) {
  const writer = new MemoryShopifyWriter();
  const publisher = new OperationPublisher({ writer });
  const safety = new SafetyGuard({ config: normalizeSafetyConfig(overrides.config) });
  const pipeline = new ValidationPipeline({ checks: defaultChecks() });
  return {
    writer,
    safety,
    stepRunner: new StepRunner({
      publisher,
      safety,
      registry: publisher.getRegistry(),
      pipeline,
      config: safety.configSnapshot,
      resourceStateProvider: async () => overrides.resourceState ?? { title: 'Old Title' },
    }),
  };
}

function rollbackableStep(): ExecutionStep {
  return makeStep({
    rollbackPlan: {
      available: true,
      reason: undefined,
      steps: [
        { action: 'restore_field', resourceType: 'product', resourceId: 'p1', payload: { field: 'title', value: 'Old Title' } },
      ],
    },
  });
}

describe('StepRunner', () => {
  it('runs a step to completion in a real mode and records state and diff', async () => {
    const { writer, stepRunner } = runner();
    const step = rollbackableStep();
    const execution = makeExecution([step]);
    const outcome = await stepRunner.run(execution, step, 'shop.example.com');
    expect(step.status).toBe('COMPLETED');
    expect(step.attemptCount).toBe(1);
    expect(step.before).toEqual({ title: 'Old Title' });
    expect(step.after).not.toBeNull();
    expect(step.apiCalls).toBe(1);
    expect(step.diffId).toBe(outcome.diff.id);
    expect(outcome.diff.stepId).toBe(step.id);
    expect(outcome.diff.changedFields).toContain('title');
    expect(writer.calls).toHaveLength(1);
  });

  it('marks a step SIMULATED in a non-real mode without writing', async () => {
    const { writer, stepRunner } = runner();
    const step = makeStep();
    const execution = makeExecution([step], 'SIMULATION');
    await stepRunner.run(execution, step, 'shop.example.com');
    expect(step.status).toBe('SIMULATED');
    expect(step.apiCalls).toBe(0);
    expect(writer.calls).toHaveLength(0);
  });

  it('fails the step and throws when validation fails', async () => {
    const { stepRunner } = runner();
    const step = makeStep({ rollbackPlan: null });
    const execution = makeExecution([step]);
    await expect(stepRunner.run(execution, step, 'shop')).rejects.toThrow(InvalidExecutionError);
    expect(step.status).toBe('FAILED');
    expect(step.error).toContain('rollback');
  });

  it('uses the supplied resource state as the before-state', async () => {
    const { stepRunner } = runner({ resourceState: { title: 'Captured' } });
    const step = rollbackableStep();
    const execution = makeExecution([step]);
    await stepRunner.run(execution, step, 'shop');
    expect(step.before).toEqual({ title: 'Captured' });
  });

  it('runs with no resource state provider', async () => {
    const writer = new MemoryShopifyWriter();
    const publisher = new OperationPublisher({ writer });
    const safety = new SafetyGuard();
    const stepRunner = new StepRunner({
      publisher,
      safety,
      registry: publisher.getRegistry(),
      pipeline: new ValidationPipeline({ checks: defaultChecks() }),
      config: safety.configSnapshot,
    });
    const step = makeStep({ isMutating: false, before: null });
    const execution = makeExecution([step]);
    const outcome = await stepRunner.run(execution, step, 'shop');
    expect(step.before).toBeNull();
    expect(outcome.diff.before).toEqual({});
    expect(step.status).toBe('COMPLETED');
  });

  it('enforces rejected action types via the safety guard', async () => {
    const { stepRunner } = runner({ config: { rejectedActionTypes: ['update_title'] } });
    const step = makeStep();
    const execution = makeExecution([step]);
    await expect(stepRunner.run(execution, step, 'shop')).rejects.toThrow();
  });
});

describe('buildValidationContext', () => {
  it('collects existing idempotency keys from the repository', async () => {
    const { InMemoryExecutionRepository } = await import('../repositories/in-memory-repository.js');
    const repository = new InMemoryExecutionRepository();
    const prior = makeStep({ id: 'prior-1' });
    prior.status = 'COMPLETED';
    await repository.saveStep(prior);

    const publisher = new OperationPublisher({ writer: new MemoryShopifyWriter() });
    const safety = new SafetyGuard();
    const step = makeStep();
    const context = await buildValidationContext({
      execution: makeExecution([step]),
      step,
      config: safety.configSnapshot,
      safety,
      registry: publisher.getRegistry(),
      repository,
    });
    expect(context.existingKeys).toContain(prior.idempotencyKey);
  });

  it('does not treat the current step as an existing key', async () => {
    const { InMemoryExecutionRepository } = await import('../repositories/in-memory-repository.js');
    const repository = new InMemoryExecutionRepository();
    const step = makeStep();
    step.status = 'COMPLETED';
    await repository.saveStep(step);

    const publisher = new OperationPublisher({ writer: new MemoryShopifyWriter() });
    const safety = new SafetyGuard();
    const context = await buildValidationContext({
      execution: makeExecution([step]),
      step,
      config: safety.configSnapshot,
      safety,
      registry: publisher.getRegistry(),
      repository,
    });
    expect(context.existingKeys).toEqual([]);
  });

  it('sets operation capability to null for unknown operations', async () => {
    const publisher = new OperationPublisher({ writer: new MemoryShopifyWriter() });
    const safety = new SafetyGuard();
    const step = makeStep({ actionType: 'custom' });
    const context = await buildValidationContext({
      execution: makeExecution([step]),
      step,
      config: safety.configSnapshot,
      safety,
      registry: publisher.getRegistry(),
    });
    expect(context.operationCapability).toBeNull();
  });

  it('exposes writer capabilities and operation capability', async () => {
    const publisher = new OperationPublisher({ writer: new MemoryShopifyWriter() });
    const safety = new SafetyGuard();
    const step = makeStep();
    const context = await buildValidationContext({
      execution: makeExecution([step]),
      step,
      config: safety.configSnapshot,
      safety,
      registry: publisher.getRegistry(),
      writerCapabilities: ['product'],
    });
    expect(context.writerCapabilities).toEqual(['product']);
    expect(context.operationCapability).toBe('product');
    expect(context.canWrite).toBe(true);
  });

  it('sets canWrite false in non-real modes', async () => {
    const publisher = new OperationPublisher({ writer: new MemoryShopifyWriter() });
    const safety = new SafetyGuard();
    const step = makeStep();
    const context = await buildValidationContext({
      execution: makeExecution([step], 'DRY_RUN'),
      step,
      config: safety.configSnapshot,
      safety,
      registry: publisher.getRegistry(),
    });
    expect(context.canWrite).toBe(false);
  });
});

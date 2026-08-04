import { describe, expect, it } from 'vitest';
import { normalizeSafetyConfig } from '../safety/config.js';
import type { Execution, ExecutionStep } from '../types/execution.js';
import type { RollbackPlan } from '../types/rollback.js';
import type { ExecutionMode } from '../types/shared.js';
import type { ValidationContext } from '../types/validation.js';
import { fail, ok } from './result.js';
import { SchemaValidator } from './schema-validator.js';
import { ApprovalValidator } from './approval-validator.js';
import { DependencyValidator } from './dependency-validator.js';
import { StateValidator } from './state-validator.js';
import { ConflictValidator } from './conflict-validator.js';
import { IdempotencyValidator } from './idempotency-validator.js';
import { RollbackValidator } from './rollback-validator.js';
import { RateLimitValidator } from './rate-limit-validator.js';
import { PermissionValidator } from './permission-validator.js';
import { PolicyValidator } from './policy-validator.js';
import { ValidationPipeline, defaultChecks } from './validation-pipeline.js';

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: 'step-1',
    executionId: 'exec-1',
    batchId: 'batch-1',
    taskId: null,
    workflowId: null,
    storeId: 'store-1',
    planId: null,
    decisionId: null,
    recommendationId: null,
    actionType: 'update_title',
    resourceType: 'product',
    resourceId: 'prod-1',
    resourceRef: 'products/prod-1',
    payload: { title: 'New Title' },
    dependsOn: [],
    before: null,
    after: null,
    expectedAfter: null,
    status: 'PENDING',
    priority: 0,
    order: 0,
    isMutating: true,
    requiresApproval: false,
    approved: false,
    approvalRequestId: null,
    attemptCount: 0,
    maxAttempts: 3,
    idempotencyKey: 'update_title:product:prod-1',
    diffId: null,
    rollbackPlan: null,
    rollbackId: null,
    durationMs: null,
    apiCalls: 0,
    error: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeExecution(steps: ExecutionStep[], mode: ExecutionMode = 'STAGING'): Execution {
  return {
    id: 'exec-1',
    storeId: 'store-1',
    planId: null,
    workflowId: null,
    decisionId: null,
    mode,
    source: 'actions',
    status: 'VALIDATING',
    steps,
    batches: [],
    history: [],
    summary: {
      total: steps.length,
      completed: 0,
      simulated: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      rolledBack: 0,
      apiCalls: 0,
      durationMs: null,
    },
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function makeContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  const mode: ExecutionMode = overrides.mode ?? 'STAGING';
  return {
    execution: makeExecution([makeStep()], mode),
    step: makeStep(),
    config: normalizeSafetyConfig(),
    mode,
    canWrite: true,
    hasRateBudget: true,
    ...overrides,
  };
}

function rollbackPlan(available: boolean, reason?: string, steps: RollbackPlan['steps'] = []): RollbackPlan {
  return { available, reason: available ? undefined : (reason ?? 'unknown'), steps };
}

describe('validation result helpers', () => {
  it('ok returns a valid empty result', () => {
    expect(ok()).toEqual({ valid: true, failures: [] });
  });

  it('fail returns a single failure with context', () => {
    const result = fail('schema', 'code', 'message', { stepId: 'x' });
    expect(result.valid).toBe(false);
    expect(result.failures).toEqual([{ check: 'schema', code: 'code', message: 'message', context: { stepId: 'x' } }]);
  });
});

describe('SchemaValidator', () => {
  const validator = new SchemaValidator();

  it('passes a well-formed step', () => {
    expect(validator.check(makeContext())).toEqual(ok());
  });

  it('rejects an empty resourceId', () => {
    const result = validator.check(makeContext({ step: makeStep({ resourceId: '' }) }));
    expect(result.valid).toBe(false);
    expect(result.failures[0]?.code).toBe('resource_id_required');
  });

  it('rejects an unknown resourceType', () => {
    const result = validator.check(makeContext({ step: makeStep({ resourceType: 'gadget' }) }));
    expect(result.failures[0]?.code).toBe('unknown_resource_type');
  });

  it('rejects a non-object payload', () => {
    const result = validator.check(makeContext({ step: makeStep({ payload: null as unknown as Record<string, unknown> }) }));
    expect(result.failures[0]?.code).toBe('payload_object');
  });

  it('rejects missing required string fields', () => {
    const result = validator.check(makeContext({ step: makeStep({ actionType: 'update_title', payload: {} }) }));
    expect(result.failures[0]?.code).toBe('missing_required_field');
  });

  it('rejects wrong-typed required fields', () => {
    const result = validator.check(
      makeContext({ step: makeStep({ actionType: 'update_theme', payload: { themeId: 123, files: [] } }) }),
    );
    expect(result.failures[0]?.code).toBe('missing_required_field');
  });

  it('accepts an update_theme step with object payload and array files', () => {
    const result = validator.check(
      makeContext({ step: makeStep({ actionType: 'update_theme', payload: { themeId: 'theme-1', files: ['a'] } }) }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a non-object product payload', () => {
    const result = validator.check(
      makeContext({ step: makeStep({ actionType: 'update_product', payload: { product: 'nope' } }) }),
    );
    expect(result.failures[0]?.code).toBe('missing_required_field');
  });
});

describe('ApprovalValidator', () => {
  const validator = new ApprovalValidator();

  it('passes when approval is not required', () => {
    expect(validator.check(makeContext({ step: makeStep({ requiresApproval: false }) })).valid).toBe(true);
  });

  it('rejects a step that requires approval without one', () => {
    const result = validator.check(makeContext({ step: makeStep({ requiresApproval: true, approved: false }) }));
    expect(result.valid).toBe(false);
    expect(result.failures[0]?.code).toBe('approval_required');
  });

  it('passes when the step is approved', () => {
    const result = validator.check(makeContext({ step: makeStep({ requiresApproval: true, approved: true }) }));
    expect(result.valid).toBe(true);
  });

  it('passes when the context approval record is approved', () => {
    const result = validator.check(
      makeContext({
        step: makeStep({ requiresApproval: true, approved: false }),
        approval: { approved: true, requestId: 'req-1', decidedBy: 'bob', decidedAt: new Date() },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects with the request id when the approval record is not approved', () => {
    const result = validator.check(
      makeContext({
        step: makeStep({ requiresApproval: true, approved: false }),
        approval: { approved: false, requestId: 'req-2', decidedBy: 'bob', decidedAt: new Date() },
      }),
    );
    expect(result.failures[0]?.code).toBe('approval_required');
    expect(result.failures[0]?.context?.requestId).toBe('req-2');
  });
});

describe('DependencyValidator', () => {
  const validator = new DependencyValidator();

  it('passes when there are no dependencies', () => {
    expect(validator.check(makeContext({ step: makeStep({ dependsOn: [] }) })).valid).toBe(true);
  });

  it('rejects unknown dependencies', () => {
    const result = validator.check(makeContext({ step: makeStep({ dependsOn: ['step-nope'] }) }));
    expect(result.valid).toBe(false);
    expect(result.failures[0]?.code).toBe('dependency_missing');
  });

  it('rejects dependencies that are not complete', () => {
    const dep = makeStep({ id: 'dep-1', status: 'PENDING' });
    const execution = makeExecution([dep, makeStep()]);
    const result = validator.check(
      makeContext({ execution, step: makeStep({ dependsOn: ['dep-1'] }) }),
    );
    expect(result.failures[0]?.code).toBe('dependency_incomplete');
  });

  it('passes when dependencies are complete or simulated', () => {
    const done = makeStep({ id: 'dep-1', status: 'COMPLETED' });
    const simulated = makeStep({ id: 'dep-2', status: 'SIMULATED' });
    const execution = makeExecution([done, simulated, makeStep()]);
    const result = validator.check(
      makeContext({ execution, step: makeStep({ dependsOn: ['dep-1', 'dep-2'] }) }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects unsatisfied external dependencies', () => {
    const dep = makeStep({ id: 'dep-1', status: 'COMPLETED' });
    const execution = makeExecution([dep, makeStep()]);
    const result = validator.check(
      makeContext({
        execution,
        step: makeStep({ dependsOn: ['dep-1'] }),
        dependencies: { satisfied: [], missing: ['prod-1'] },
      }),
    );
    expect(result.failures[0]?.code).toBe('dependency_unsatisfied');
  });

  it('rejects external dependencies matched through the step dependencies', () => {
    const dep = makeStep({ id: 'dep-1', status: 'COMPLETED' });
    const execution = makeExecution([dep, makeStep({ resourceId: 'prod-2' })]);
    const result = validator.check(
      makeContext({
        execution,
        step: makeStep({ resourceId: 'prod-2', dependsOn: ['dep-1'] }),
        dependencies: { satisfied: [], missing: ['dep-1'] },
      }),
    );
    expect(result.failures[0]?.code).toBe('dependency_unsatisfied');
  });
});

describe('StateValidator', () => {
  const validator = new StateValidator();

  it('skips verification in non-real modes', () => {
    const result = validator.check(makeContext({ mode: 'DRY_RUN', step: makeStep({ isMutating: true }) }));
    expect(result.valid).toBe(true);
  });

  it('passes when state was verified', () => {
    const result = validator.check(
      makeContext({ resourceState: { title: 'Old' }, step: makeStep({ isMutating: true }) }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects an unverified state before a real write', () => {
    const result = validator.check(makeContext({ step: makeStep({ isMutating: true }) }));
    expect(result.valid).toBe(false);
    expect(result.failures[0]?.code).toBe('state_not_checked');
  });

  it('passes for store-level writes without state', () => {
    const result = validator.check(
      makeContext({ step: makeStep({ resourceType: 'store', isMutating: true }) }),
    );
    expect(result.valid).toBe(true);
  });

  it('passes for create_page without state', () => {
    const result = validator.check(
      makeContext({ step: makeStep({ actionType: 'create_page', resourceType: 'page', isMutating: true }) }),
    );
    expect(result.valid).toBe(true);
  });

  it('passes when requireStateCheck is disabled', () => {
    const result = validator.check(
      makeContext({ config: normalizeSafetyConfig({ requireStateCheck: false }), step: makeStep({ isMutating: true }) }),
    );
    expect(result.valid).toBe(true);
  });
});

describe('ConflictValidator', () => {
  const validator = new ConflictValidator();

  it('passes when the store is not locked', () => {
    expect(validator.check(makeContext({ storeLockedBy: null })).valid).toBe(true);
  });

  it('passes when the lock belongs to this execution', () => {
    expect(validator.check(makeContext({ storeLockedBy: 'exec-1' })).valid).toBe(true);
  });

  it('rejects a lock held by another execution', () => {
    const result = validator.check(makeContext({ storeLockedBy: 'exec-other' }));
    expect(result.valid).toBe(false);
    expect(result.failures[0]?.code).toBe('store_locked');
  });
});

describe('IdempotencyValidator', () => {
  const validator = new IdempotencyValidator();

  it('passes when the key was not applied', () => {
    expect(validator.check(makeContext({ existingKeys: ['other'] })).valid).toBe(true);
  });

  it('rejects an already-applied key', () => {
    const result = validator.check(makeContext({ existingKeys: ['update_title:product:prod-1'] }));
    expect(result.valid).toBe(false);
    expect(result.failures[0]?.code).toBe('already_applied');
  });
});

describe('RollbackValidator', () => {
  const validator = new RollbackValidator();

  it('skips validation in non-real modes', () => {
    expect(validator.check(makeContext({ mode: 'DRY_RUN' })).valid).toBe(true);
  });

  it('skips non-mutating steps', () => {
    expect(validator.check(makeContext({ step: makeStep({ isMutating: false }) })).valid).toBe(true);
  });

  it('passes when a rollback plan is available', () => {
    const result = validator.check(makeContext({ step: makeStep({ rollbackPlan: rollbackPlan(true) }) }));
    expect(result.valid).toBe(true);
  });

  it('rejects a mutating step without an available rollback plan', () => {
    const result = validator.check(makeContext({ step: makeStep({ rollbackPlan: null }) }));
    expect(result.failures[0]?.code).toBe('rollback_unavailable');
  });

  it('rejects an unavailable rollback plan with its reason', () => {
    const result = validator.check(
      makeContext({ step: makeStep({ rollbackPlan: rollbackPlan(false, 'cannot restore') }) }),
    );
    expect(result.valid).toBe(false);
    expect(result.failures[0]?.message).toContain('cannot restore');
  });
});

describe('RateLimitValidator', () => {
  const validator = new RateLimitValidator();

  it('skips non-real modes', () => {
    expect(validator.check(makeContext({ mode: 'SIMULATION' })).valid).toBe(true);
  });

  it('skips non-mutating steps', () => {
    expect(validator.check(makeContext({ step: makeStep({ isMutating: false }) })).valid).toBe(true);
  });

  it('passes when there is rate budget', () => {
    expect(validator.check(makeContext({ hasRateBudget: true })).valid).toBe(true);
  });

  it('rejects when the rate budget is exhausted', () => {
    const result = validator.check(makeContext({ hasRateBudget: false }));
    expect(result.valid).toBe(false);
    expect(result.failures[0]?.code).toBe('rate_limit_exhausted');
  });
});

describe('PermissionValidator', () => {
  const validator = new PermissionValidator();

  it('skips non-real modes', () => {
    expect(validator.check(makeContext({ mode: 'DRY_RUN' })).valid).toBe(true);
  });

  it('skips non-mutating steps', () => {
    expect(validator.check(makeContext({ step: makeStep({ isMutating: false }) })).valid).toBe(true);
  });

  it('rejects when writes are denied', () => {
    const result = validator.check(makeContext({ canWrite: false }));
    expect(result.failures[0]?.code).toBe('write_denied');
  });

  it('rejects when the writer lacks the required capability', () => {
    const result = validator.check(
      makeContext({ operationCapability: 'write', writerCapabilities: [] }),
    );
    expect(result.failures[0]?.code).toBe('capability_missing');
  });

  it('passes when the capability is available', () => {
    const result = validator.check(
      makeContext({ operationCapability: 'write', writerCapabilities: ['write'] }),
    );
    expect(result.valid).toBe(true);
  });

  it('skips the capability check when no capability is declared', () => {
    const result = validator.check(makeContext({ operationCapability: null }));
    expect(result.valid).toBe(true);
  });
});

describe('PolicyValidator', () => {
  const validator = new PolicyValidator();

  it('rejects a mode that is not allowed by the safety config', () => {
    const result = validator.check(
      makeContext({ config: normalizeSafetyConfig({ allowedModes: ['DRY_RUN'] }), mode: 'PRODUCTION' }),
    );
    expect(result.failures[0]?.code).toBe('mode_not_allowed');
  });

  it('rejects production when disabled by feature flag', () => {
    const result = validator.check(
      makeContext({
        config: normalizeSafetyConfig({ featureFlags: { 'allow-production': false } }),
        mode: 'PRODUCTION',
      }),
    );
    expect(result.failures[0]?.code).toBe('production_disabled');
  });

  it('passes when production is allowed', () => {
    const result = validator.check(
      makeContext({
        config: normalizeSafetyConfig({ featureFlags: { 'allow-production': true } }),
        mode: 'PRODUCTION',
      }),
    );
    expect(result.valid).toBe(true);
  });
});

describe('ValidationPipeline', () => {
  it('runs checks in registration order and aggregates failures', async () => {
    const first = new SchemaValidator();
    const second = new PolicyValidator();
    const pipeline = new ValidationPipeline({ checks: [first, second] });
    const ctx = makeContext({
      step: makeStep({ resourceId: '', actionType: 'update_title', payload: { title: 'x' } }),
      config: normalizeSafetyConfig({ allowedModes: ['DRY_RUN'] }),
      mode: 'PRODUCTION',
    });
    const result = await pipeline.validate(ctx);
    expect(result.valid).toBe(false);
    expect(result.failures.map((f) => f.code)).toEqual(['resource_id_required', 'mode_not_allowed']);
    expect(result.failures.every((f) => f.stepId === 'step-1')).toBe(true);
  });

  it('stops collecting after maxFailures', async () => {
    const pipeline = new ValidationPipeline({ checks: defaultChecks(), maxFailures: 2 });
    const result = await pipeline.validate(
      makeContext({ step: makeStep({ resourceId: '' }), mode: 'PRODUCTION', hasRateBudget: false, canWrite: false }),
    );
    expect(result.failures.length).toBe(2);
  });

  it('stops at the first failing check when maxFailures is 1', async () => {
    const pipeline = new ValidationPipeline({ checks: defaultChecks(), maxFailures: 1 });
    const result = await pipeline.validate(makeContext({ step: makeStep({ resourceId: '' }) }));
    expect(result.failures.length).toBe(1);
  });

  it('throws when adding a check with a duplicate id', () => {
    const pipeline = new ValidationPipeline();
    pipeline.addCheck(new SchemaValidator());
    expect(() => pipeline.addCheck(new SchemaValidator())).toThrow(/already registered/);
  });

  it('lists registered checks', () => {
    const pipeline = new ValidationPipeline({ checks: defaultChecks() });
    expect(pipeline.listChecks()).toEqual([
      'schema',
      'policy',
      'approval',
      'dependency',
      'state',
      'conflict',
      'idempotency',
      'rollback',
      'rate_limit',
      'permission',
    ]);
  });

  it('passes a valid step through the default pipeline', async () => {
    const pipeline = new ValidationPipeline({ checks: defaultChecks() });
    const step = makeStep({
      rollbackPlan: rollbackPlan(true, undefined, [
        { action: 'restore_field', resourceType: 'product', resourceId: 'prod-1', payload: { title: 'Old' } },
      ]),
    });
    const result = await pipeline.validate(
      makeContext({ step, resourceState: { title: 'Old' }, writerCapabilities: ['write'], operationCapability: 'write' }),
    );
    expect(result.valid).toBe(true);
  });

  it('executes asynchronous checks', async () => {
    const asyncCheck = {
      id: 'async',
      async check(): Promise<ReturnType<typeof ok>> {
        return ok();
      },
    };
    const pipeline = new ValidationPipeline({ checks: [asyncCheck] });
    expect((await pipeline.validate(makeContext())).valid).toBe(true);
  });
});

describe('defaultChecks', () => {
  it('returns a fresh list each call', () => {
    expect(defaultChecks()).toHaveLength(10);
    expect(defaultChecks()).not.toBe(defaultChecks());
  });
});

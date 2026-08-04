import { describe, expect, it } from 'vitest';
import type { Execution } from '../types/execution.js';
import { buildExecution, buildStep } from '../models/execution.js';
import { ApprovalRequiredError, SafetyViolationError } from '../utils/errors.js';
import { SafetyGuard } from './safety-guard.js';
import { normalizeSafetyConfig } from './config.js';

function makeExecution(
  id: string,
  storeId = 's1',
  overrides: Partial<Execution> = {},
  stepOptions: { count?: number; requiresApproval?: boolean; approved?: boolean } = {},
): Execution {
  const steps = Array.from({ length: stepOptions.count ?? 1 }, (_, index) =>
    buildStep({
      executionId: id,
      batchId: 'b',
      storeId,
      actionType: 'update_title',
      resourceType: 'product',
      resourceId: `p${index + 1}`,
      payload: {},
      order: index,
      requiresApproval: stepOptions.requiresApproval,
      approved: stepOptions.approved,
    }),
  );
  return buildExecution({ id, storeId, mode: 'PRODUCTION', source: 'actions', steps, batches: [], ...overrides });
}

describe('safety guard', () => {
  it('allows a clean execution', () => {
    const guard = new SafetyGuard();
    const assessment = guard.assessExecution(makeExecution('exec-1'));
    expect(assessment.allowed).toBe(true);
    expect(assessment.violations).toEqual([]);
    expect(() => guard.assertCanExecute(makeExecution('exec-1'))).not.toThrow();
  });

  it('blocks disallowed modes', () => {
    const guard = new SafetyGuard({ config: normalizeSafetyConfig({ allowedModes: ['DRY_RUN'] }) });
    const execution = makeExecution('exec-1');
    const assessment = guard.assessExecution(execution);
    expect(assessment.allowed).toBe(false);
    expect(assessment.checks.find((c) => c.id === 'mode')?.passed).toBe(false);
    expect(() => guard.assertCanExecute(execution)).toThrow(SafetyViolationError);
  });

  it('blocks oversized batches', () => {
    const guard = new SafetyGuard({ config: normalizeSafetyConfig({ maxBatchSize: 1 }) });
    const execution = makeExecution('exec-1', 's1', {}, { count: 2 });
    expect(guard.assessExecution(execution).checks.find((c) => c.id === 'batch_size')?.passed).toBe(false);
  });

  it('blocks stopped stores and resumes them', () => {
    const guard = new SafetyGuard();
    guard.killSwitch.stop('s1');
    expect(guard.assessExecution(makeExecution('exec-1')).allowed).toBe(false);
    guard.resume('s1');
    expect(guard.assessExecution(makeExecution('exec-1')).allowed).toBe(true);
  });

  it('blocks execution when another execution holds the store lock', () => {
    const guard = new SafetyGuard();
    guard.storeLock.acquire('s1', 'exec-0');
    const assessment = guard.assessExecution(makeExecution('exec-1'));
    expect(assessment.checks.find((c) => c.id === 'store_lock')?.passed).toBe(false);
    expect(assessment.allowed).toBe(false);
  });

  it('allows when the lock belongs to the execution itself', () => {
    const guard = new SafetyGuard();
    guard.storeLock.acquire('s1', 'exec-1');
    const assessment = guard.assessExecution(makeExecution('exec-1'));
    expect(assessment.checks.find((c) => c.id === 'store_lock')?.passed).toBe(true);
  });

  it('ignores the lock when enforceStoreLock is false', () => {
    const guard = new SafetyGuard({ config: normalizeSafetyConfig({ enforceStoreLock: false }) });
    guard.storeLock.acquire('s1', 'exec-0');
    expect(guard.assessExecution(makeExecution('exec-1')).allowed).toBe(true);
  });

  it('rejects conflicting active executions', () => {
    const guard = new SafetyGuard();
    const active = [makeExecution('exec-0', 's1', { status: 'EXECUTING' })];
    const assessment = guard.assessExecution(makeExecution('exec-1'), active);
    expect(assessment.checks.find((c) => c.id === 'conflicts')?.passed).toBe(false);
    expect(assessment.allowed).toBe(false);
  });

  it('rejects never-allowed action types', () => {
    const guard = new SafetyGuard();
    const execution = makeExecution('exec-1');
    execution.steps[0]!.actionType = 'delete_page';
    const assessment = guard.assessExecution(execution);
    expect(assessment.checks.find((c) => c.id === 'rejected_actions')?.passed).toBe(false);
    expect(() => guard.assertCanExecute(execution)).toThrow(SafetyViolationError);
    expect(() => guard.assertStep(execution.steps[0]!)).toThrow(SafetyViolationError);
  });

  it('requires approval for unapproved steps and allows approved ones', () => {
    const guard = new SafetyGuard();
    const execution = makeExecution('exec-1', 's1', {}, { requiresApproval: true });
    const blocked = guard.assessExecution(execution);
    expect(blocked.checks.find((c) => c.id === 'approval')?.passed).toBe(false);
    expect(() => guard.assertStep(execution.steps[0]!)).toThrow(ApprovalRequiredError);
    execution.steps[0]!.approved = true;
    expect(guard.assessExecution(execution).allowed).toBe(true);
    expect(() => guard.assertStep(execution.steps[0]!)).not.toThrow();
  });

  it('emergencyStop only engages when enabled', () => {
    const guard = new SafetyGuard();
    guard.emergencyStop('s1');
    expect(guard.killSwitch.isStopped('s1')).toBe(true);
    const disabled = new SafetyGuard({ config: normalizeSafetyConfig({ emergencyStopEnabled: false }) });
    disabled.emergencyStop('s1');
    expect(disabled.killSwitch.isStopped('s1')).toBe(false);
  });
});

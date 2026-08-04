import type { Execution, ExecutionStep } from '../types/execution.js';
import type { SafetyCheckResult, SafetyConfig } from '../types/safety.js';
import { ApprovalRequiredError, SafetyViolationError } from '../utils/errors.js';
import { assertValidConfig, normalizeSafetyConfig } from './config.js';
import { detectConflicts } from './conflict-detector.js';
import { KillSwitch } from './kill-switch.js';
import { RateLimiter } from './rate-limiter.js';
import { StoreLock } from './store-lock.js';

export interface SafetyGuardOptions {
  config?: SafetyConfig;
  killSwitch?: KillSwitch;
  storeLock?: StoreLock;
  rateLimiter?: RateLimiter;
}

export interface SafetyAssessment {
  allowed: boolean;
  violations: string[];
  checks: SafetyCheckResult[];
}

/**
 * The safety model of the execution engine: mode gating, batch caps, kill
 * switches, store locks, conflict detection, rejected action types and
 * approval enforcement all live here and are checked before any write.
 */
export class SafetyGuard {
  readonly killSwitch: KillSwitch;
  readonly storeLock: StoreLock;
  readonly rateLimiter: RateLimiter;
  private readonly config: SafetyConfig;

  constructor(options: SafetyGuardOptions = {}) {
    this.config = normalizeSafetyConfig(options.config);
    assertValidConfig(this.config);
    this.killSwitch = options.killSwitch ?? new KillSwitch();
    this.storeLock = options.storeLock ?? new StoreLock();
    this.rateLimiter =
      options.rateLimiter ?? new RateLimiter({ perMinute: this.config.maxWriteRatePerMinute });
  }

  get configSnapshot(): SafetyConfig {
    return this.config;
  }

  assessExecution(execution: Execution, active: Execution[] = []): SafetyAssessment {
    const checks: SafetyCheckResult[] = [];
    const violations: string[] = [];

    const modeAllowed = this.config.allowedModes.includes(execution.mode);
    checks.push({
      id: 'mode',
      passed: modeAllowed,
      message: `mode ${execution.mode} ${modeAllowed ? 'allowed' : 'blocked by allowedModes'}`,
    });
    if (!modeAllowed) violations.push(`mode ${execution.mode} is not allowed by safety config`);

    const batchOk = execution.steps.length <= this.config.maxBatchSize;
    checks.push({
      id: 'batch_size',
      passed: batchOk,
      message: `${execution.steps.length}/${this.config.maxBatchSize} steps`,
    });
    if (!batchOk) {
      violations.push(
        `batch size ${execution.steps.length} exceeds maxBatchSize ${this.config.maxBatchSize}`,
      );
    }

    const stopped = this.killSwitch.isStopped(execution.storeId);
    checks.push({
      id: 'kill_switch',
      passed: !stopped,
      message: stopped ? 'kill switch engaged' : 'kill switch clear',
    });
    if (stopped) violations.push(`kill switch engaged for store ${execution.storeId}`);

    let lockOwner = this.storeLock.owner(execution.storeId);
    if (!this.config.enforceStoreLock) lockOwner = null;
    const lockOk = lockOwner === null || lockOwner === execution.id;
    checks.push({
      id: 'store_lock',
      passed: lockOk,
      message: lockOwner === null ? 'store unlocked' : `store locked by ${lockOwner}`,
    });
    if (!lockOk) violations.push(`store ${execution.storeId} is locked by ${lockOwner}`);

    const conflicts = detectConflicts(execution, active);
    checks.push({
      id: 'conflicts',
      passed: conflicts.length === 0,
      message: conflicts.length === 0 ? 'no conflicting executions' : `${conflicts.length} conflict(s)`,
    });
    for (const conflict of conflicts) {
      violations.push(`conflicting execution ${conflict.id} is active for ${conflict.storeId}`);
    }

    const rejected = execution.steps
      .filter((step) => this.config.rejectedActionTypes.includes(step.actionType))
      .map((step) => step.actionType);
    const rejectedUnique = [...new Set(rejected)];
    checks.push({
      id: 'rejected_actions',
      passed: rejectedUnique.length === 0,
      message:
        rejectedUnique.length === 0 ? 'no rejected action types' : `rejected: ${rejectedUnique.join(', ')}`,
    });
    for (const actionType of rejectedUnique) {
      violations.push(`action type ${actionType} is never allowed`);
    }

    const unapproved = execution.steps.filter(
      (step) => step.requiresApproval && !step.approved,
    ).length;
    checks.push({
      id: 'approval',
      passed: unapproved === 0,
      message: unapproved === 0 ? 'approval satisfied' : `${unapproved} step(s) awaiting approval`,
    });
    if (unapproved > 0) violations.push(`${unapproved} step(s) require approval`);

    return { allowed: violations.length === 0, violations, checks };
  }

  /** Throws when the execution may not proceed. */
  assertCanExecute(execution: Execution, active: Execution[] = []): void {
    const assessment = this.assessExecution(execution, active);
    if (!assessment.allowed) {
      throw new SafetyViolationError(assessment.violations.join('; '), {
        module: 'execution-engine',
        operation: 'execution.assertCanExecute',
        context: { executionId: execution.id, storeId: execution.storeId },
      });
    }
  }

  /** Throws when a single step may not be published. */
  assertStep(step: ExecutionStep): void {
    if (this.config.rejectedActionTypes.includes(step.actionType)) {
      throw new SafetyViolationError(`action type ${step.actionType} is never allowed`, {
        module: 'execution-engine',
        operation: 'execution.assertStep',
        context: { stepId: step.id, actionType: step.actionType },
      });
    }
    if (step.requiresApproval && !step.approved) {
      throw new ApprovalRequiredError(`step ${step.id} requires approval before execution`, {
        module: 'execution-engine',
        operation: 'execution.assertStep',
        context: { stepId: step.id, storeId: step.storeId },
      });
    }
  }

  /** Emergency stop: freezes writes globally or for one store. */
  emergencyStop(storeId?: string): void {
    if (this.config.emergencyStopEnabled) {
      this.killSwitch.stop(storeId);
    }
  }

  resume(storeId?: string): void {
    this.killSwitch.resume(storeId);
  }
}

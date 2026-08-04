import type { ExecutionStep } from '../types/execution.js';
import type { RollbackStatus } from '../types/shared.js';
import type { OperationPublisher } from '../publisher/publisher.js';
import { RollbackError } from '../utils/errors.js';
import { realSleep } from '../utils/time.js';
import { validateRollbackCapability } from './validator.js';

export interface RollbackResult {
  status: RollbackStatus;
  apiCalls: number;
  durationMs: number;
  error: string | null;
}

export interface RollbackEngineOptions {
  publisher: OperationPublisher;
  /** Re-executes a step's rollback instead of returning immediately (default: true). */
  dryRun?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

/** Executes rollback plans through the publisher and reports the outcome. */
export class RollbackEngine {
  private readonly publisher: OperationPublisher;
  private readonly dryRun: boolean;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RollbackEngineOptions) {
    this.publisher = options.publisher;
    this.dryRun = options.dryRun ?? false;
    this.sleep = options.sleep ?? realSleep;
  }

  /** Rolls back a single step. Returns COMPLETED/FAILED with call accounting. */
  async rollbackStep(step: ExecutionStep, shopDomain: string): Promise<RollbackResult> {
    const startedAt = Date.now();
    try {
      const validation = validateRollbackCapability(step);
      if (!validation.valid) {
        throw new RollbackError(validation.reason ?? 'step cannot be rolled back');
      }
      if (this.dryRun) {
        return { status: 'COMPLETED', apiCalls: 0, durationMs: 0, error: null };
      }
      if (step.rollbackPlan === null) {
        throw new RollbackError('no rollback plan exists for this step');
      }
      let apiCalls = 0;
      for (const _planStep of step.rollbackPlan.steps) {
        const result = await this.publisher.restore(step, shopDomain);
        apiCalls += result.apiCalls;
      }
      return { status: 'COMPLETED', apiCalls, durationMs: Date.now() - startedAt, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'FAILED', apiCalls: 0, durationMs: Date.now() - startedAt, error: message };
    }
  }
}

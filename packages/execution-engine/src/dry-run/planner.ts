import type { Execution } from '../types/execution.js';
import type { OperationRegistry } from '../types/publisher.js';
import type { ExecutionMode } from '../types/shared.js';

export interface DryRunEstimate {
  total: number;
  mutating: number;
  readOnly: number;
  apiCalls: number;
  byAction: Record<string, number>;
}

/** Precomputes expected-after states so dry-runs and simulations can be
 * reviewed before any write is attempted. Never touches the writer. */
export class DryRunPlanner {
  private readonly registry: OperationRegistry;

  constructor(registry: OperationRegistry) {
    this.registry = registry;
  }

  /** Fills each step's `expectedAfter` from the matching operation. */
  plan(execution: Execution): void {
    for (const step of execution.steps) {
      if (step.status !== 'PENDING' && step.status !== 'READY') continue;
      try {
        const operation = this.registry.get(step.actionType, step.resourceType);
        step.expectedAfter = operation.expectedAfter(step);
      } catch {
        step.expectedAfter = null;
      }
    }
  }

  /** Preview of what an execution would do, without executing anything. */
  estimate(execution: Execution, mode: ExecutionMode): DryRunEstimate {
    const byAction: Record<string, number> = {};
    let mutating = 0;
    let readOnly = 0;
    let apiCalls = 0;
    for (const step of execution.steps) {
      const operation = this.registry.has(step.actionType, step.resourceType)
        ? this.registry.get(step.actionType, step.resourceType)
        : null;
      byAction[step.actionType] = (byAction[step.actionType] ?? 0) + 1;
      if (step.isMutating) {
        mutating += 1;
        if (mode === 'STAGING' || mode === 'PRODUCTION') {
          apiCalls += operation?.supportsWrite === true ? 1 : 0;
        }
      } else {
        readOnly += 1;
      }
    }
    return { total: execution.steps.length, mutating, readOnly, apiCalls, byAction };
  }
}

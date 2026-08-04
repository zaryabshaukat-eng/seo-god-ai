import type { Execution, ExecutionStep } from '../types/execution.js';
import type { ApprovalInput } from '../types/plan.js';
import type { ExecutionRepository } from '../types/repository.js';

export interface ApprovalDecision {
  stepId: string;
  approved: boolean;
  decidedBy?: string;
  decidedAt?: Date;
  reason?: string;
}

/** In-memory approval gate. Records decisions and produces the
 * {@link ApprovalInput} the planner consumes. */
export class ApprovalGate {
  private readonly decisions = new Map<string, ApprovalDecision>();
  private readonly repository?: ExecutionRepository;

  constructor(repository?: ExecutionRepository) {
    this.repository = repository;
  }

  approve(executionId: string, stepIds: string[], decidedBy = 'system'): void {
    for (const stepId of stepIds) {
      this.decisions.set(stepId, { stepId, approved: true, decidedBy, decidedAt: new Date() });
    }
    this.applyToExecution(executionId);
  }

  reject(executionId: string, stepIds: string[], reason: string): void {
    for (const stepId of stepIds) {
      this.decisions.set(stepId, {
        stepId,
        approved: false,
        decidedBy: 'system',
        decidedAt: new Date(),
        reason,
      });
    }
    this.applyToExecution(executionId);
  }

  decisionFor(stepId: string): ApprovalDecision | null {
    return this.decisions.get(stepId) ?? null;
  }

  pendingApprovals(execution: Execution): ExecutionStep[] {
    return execution.steps.filter((step) => step.requiresApproval && !step.approved);
  }

  /** Builds the planner input carrying every approved step for this execution. */
  toInput(execution: Execution): ApprovalInput {
    const approvedIds = execution.steps
      .filter((step) => step.approved || this.decisions.get(step.id)?.approved === true)
      .map((step) => step.id);
    const requestIds: Record<string, string> = {};
    for (const step of execution.steps) {
      if (step.approvalRequestId !== null) requestIds[step.id] = step.approvalRequestId;
    }
    return { approvedIds, requestIds };
  }

  private async applyToExecution(executionId: string): Promise<void> {
    if (this.repository === undefined) return;
    const execution = await this.repository.getExecution(executionId);
    if (execution === null) return;
    let changed = false;
    for (const step of execution.steps) {
      const decision = this.decisions.get(step.id);
      if (decision !== undefined) {
        step.approved = decision.approved;
        changed = true;
      }
    }
    if (changed) await this.repository.saveExecution(execution);
  }
}

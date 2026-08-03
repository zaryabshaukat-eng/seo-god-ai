import type { DecisionSummary } from '../types/decision.js';
import type { DecisionEngineInput } from '../types/input.js';
import type { ExecutionPlan } from '../types/plan.js';

/**
 * Deterministic decision summaries. The initial summary captures the
 * recommendation count; after planning it is replaced by the full plan-derived
 * summary (tasks, batches, estimates, risk).
 */
export class DecisionSummaryModel {
  static initial(input: DecisionEngineInput): DecisionSummary {
    return {
      recommendationCount: input.recommendations.length,
      taskCount: 0,
      batchCount: 0,
      estimatedExecutionMinutes: 0,
      totalEffortHours: 0,
      totalImpact: 0,
      highRiskTaskCount: 0,
      approvalRequired: false,
    };
  }

  static forPlan(input: DecisionEngineInput, plan: ExecutionPlan): DecisionSummary {
    return {
      recommendationCount: input.recommendations.length,
      taskCount: plan.tasks.length,
      batchCount: plan.batches.length,
      estimatedExecutionMinutes: plan.estimatedDurationMinutes,
      totalEffortHours: plan.totalEffortHours,
      totalImpact: plan.totalImpact,
      highRiskTaskCount: plan.tasks.filter((task) => task.risk === 'HIGH').length,
      approvalRequired: plan.status === 'AWAITING_APPROVAL',
    };
  }
}

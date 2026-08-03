import type { ApprovalRequest } from '../types/approval.js';
import type { Decision } from '../types/decision.js';
import type { ExecutionPlan, ExecutionTask } from '../types/plan.js';
import type { ExecutionResult, RollbackRecord } from '../types/result.js';
import type { DecisionRepository } from '../repositories/decision-repository.js';

/** In-memory {@link DecisionRepository} for tests. */
export class InMemoryDecisionRepository implements DecisionRepository {
  private readonly decisions = new Map<string, Decision>();
  private readonly plans = new Map<string, ExecutionPlan>();
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly results = new Map<string, ExecutionResult>();
  private readonly records = new Map<string, RollbackRecord>();

  async saveDecision(decision: Decision): Promise<Decision> {
    this.decisions.set(decision.id, decision);
    return decision;
  }
  async getDecision(id: string): Promise<Decision | null> {
    return this.decisions.get(id) ?? null;
  }
  async savePlan(plan: ExecutionPlan): Promise<ExecutionPlan> {
    this.plans.set(plan.id, plan);
    return plan;
  }
  async getPlan(id: string): Promise<ExecutionPlan | null> {
    return this.plans.get(id) ?? null;
  }
  async getPlanByDecision(decisionId: string): Promise<ExecutionPlan | null> {
    let latest: ExecutionPlan | null = null;
    for (const plan of this.plans.values()) {
      if (plan.decisionId === decisionId && (latest === null || plan.version > latest.version)) {
        latest = plan;
      }
    }
    return latest;
  }
  async listPlans(storeId: string): Promise<ExecutionPlan[]> {
    return [...this.plans.values()].filter((plan) => plan.storeId === storeId);
  }
  async listTasks(planId: string): Promise<ExecutionTask[]> {
    const plan = this.plans.get(planId);
    return plan === undefined ? [] : [...plan.tasks];
  }
  async saveApprovalRequest(request: ApprovalRequest): Promise<ApprovalRequest> {
    this.requests.set(request.id, request);
    return request;
  }
  async listApprovalRequests(storeId: string): Promise<ApprovalRequest[]> {
    return [...this.requests.values()].filter((request) => request.storeId === storeId);
  }
  async saveExecutionResult(result: ExecutionResult): Promise<ExecutionResult> {
    this.results.set(result.id, result);
    return result;
  }
  async listExecutionResults(planId: string): Promise<ExecutionResult[]> {
    return [...this.results.values()].filter((result) => result.planId === planId);
  }
  async saveRollbackRecord(record: RollbackRecord): Promise<RollbackRecord> {
    this.records.set(record.id, record);
    return record;
  }
  async listRollbackRecords(storeId: string): Promise<RollbackRecord[]> {
    return [...this.records.values()].filter((record) => record.storeId === storeId);
  }
}

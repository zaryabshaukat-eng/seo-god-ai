import type {
  AgentRunRecord,
  FeedbackRecord,
  MemoryEntry,
  MemoryQuery,
  ValidationFailureRecord,
} from '../types/memory.js';

export interface RunFilter {
  storeId?: string;
  agentId?: string;
  taskId?: string;
}

export interface PerformanceSnapshot {
  runs: number;
  averageConfidence: number;
  averageTokens: number;
  estimatedCost: number;
}

export interface AgentRepository {
  saveRun(run: AgentRunRecord): Promise<void>;
  getRun(id: string): Promise<AgentRunRecord | null>;
  listRuns(filter?: RunFilter): Promise<AgentRunRecord[]>;
  saveMemory(entry: MemoryEntry): Promise<void>;
  queryMemory(query: MemoryQuery): Promise<MemoryEntry[]>;
  saveFeedback(feedback: FeedbackRecord): Promise<void>;
  listFeedback(filter?: { storeId?: string; agentId?: string }): Promise<FeedbackRecord[]>;
  saveValidationFailure(failure: ValidationFailureRecord): Promise<void>;
  listValidationFailures(filter?: { storeId?: string; agentId?: string }): Promise<ValidationFailureRecord[]>;
  performanceSnapshot(filter: { storeId: string; agentId: string }): Promise<PerformanceSnapshot>;
}

function matches(record: object, filter: object): boolean {
  const candidate = record as Record<string, unknown>;
  const criteria = filter as Record<string, unknown>;
  return Object.entries(criteria).every(
    ([key, value]) => value === undefined || candidate[key] === value,
  );
}

/** In-memory agent store. Persistence adapters can implement the same interface. */
export class InMemoryAgentRepository implements AgentRepository {
  private readonly runs: AgentRunRecord[] = [];
  private readonly memory: MemoryEntry[] = [];
  private readonly feedback: FeedbackRecord[] = [];
  private readonly validationFailures: ValidationFailureRecord[] = [];

  async saveRun(run: AgentRunRecord): Promise<void> {
    this.runs.push(run);
  }

  async getRun(id: string): Promise<AgentRunRecord | null> {
    return this.runs.find((run) => run.id === id) ?? null;
  }

  async listRuns(filter: RunFilter = {}): Promise<AgentRunRecord[]> {
    return this.runs
      .filter((run) => matches(run, filter))
      .slice()
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  async saveMemory(entry: MemoryEntry): Promise<void> {
    this.memory.push(entry);
  }

  async queryMemory(query: MemoryQuery): Promise<MemoryEntry[]> {
    const filter: Record<string, unknown> = {
      storeId: query.storeId,
      agentId: query.agentId,
      workflowId: query.workflowId,
      kind: query.kind,
      key: query.key,
    };
    const results = this.memory
      .filter((entry) => matches(entry, filter))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return query.limit === undefined ? results : results.slice(0, query.limit);
  }

  async saveFeedback(feedback: FeedbackRecord): Promise<void> {
    this.feedback.push(feedback);
  }

  async listFeedback(filter: { storeId?: string; agentId?: string } = {}): Promise<FeedbackRecord[]> {
    return this.feedback
      .filter((entry) => matches(entry, filter))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async saveValidationFailure(failure: ValidationFailureRecord): Promise<void> {
    this.validationFailures.push(failure);
  }

  async listValidationFailures(filter: { storeId?: string; agentId?: string } = {}): Promise<ValidationFailureRecord[]> {
    return this.validationFailures
      .filter((entry) => matches(entry, filter))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async performanceSnapshot(filter: { storeId: string; agentId: string }): Promise<PerformanceSnapshot> {
    const runs = this.runs.filter(
      (run) => run.storeId === filter.storeId && run.agentId === filter.agentId,
    );
    if (runs.length === 0) {
      return { runs: 0, averageConfidence: 0, averageTokens: 0, estimatedCost: 0 };
    }
    const averageConfidence =
      runs.reduce((total, run) => total + run.confidence, 0) / runs.length;
    const averageTokens = runs.reduce((total, run) => total + run.tokenEstimate, 0) / runs.length;
    const estimatedCost = runs.reduce((total, run) => total + run.costEstimate, 0);
    return { runs: runs.length, averageConfidence, averageTokens, estimatedCost };
  }
}

import { MemoryEntryModel } from '../models/memory-entry.js';
import { newId } from '../utils/ids.js';
import type { AgentResult } from '../types/output.js';
import type {
  AgentRunRecord,
  FeedbackRecord,
  MemoryEntry,
  MemoryQuery,
  ValidationFailureRecord,
} from '../types/memory.js';
import type { AgentRepository } from '../repositories/agent-repository.js';
import type { ValidationFailure } from '../types/validation.js';

export interface AgentMemoryStore {
  add(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry>;
  query(query: MemoryQuery): Promise<MemoryEntry[]>;
  latest(storeId: string, kind: MemoryEntry['kind'], key: string): Promise<MemoryEntry | null>;
  recordHistory(params: RecordHistoryParams): Promise<MemoryEntry>;
  recordExecution(params: { storeId: string; agentId: string; run: AgentRunRecord }): Promise<MemoryEntry>;
  recordPerformance(params: { storeId: string; agentId: string; run: AgentRunRecord }): Promise<MemoryEntry>;
  recordFeedback(params: RecordFeedbackParams): Promise<FeedbackRecord>;
  recordValidationFailure(params: RecordValidationFailureParams): Promise<ValidationFailureRecord>;
}

export interface RecordHistoryParams {
  storeId: string;
  agentId: string;
  workflowId?: string;
  result: AgentResult;
}

export interface RecordFeedbackParams {
  storeId: string;
  agentId: string;
  taskId: string;
  workflowId?: string;
  rating: number;
  comment?: string;
}

export interface RecordValidationFailureParams {
  storeId: string;
  agentId: string;
  taskId: string;
  workflowId?: string;
  failures: ValidationFailure[];
}

/**
 * Persistent memory around agent runs: execution history, feedback, validation
 * failures and performance metrics. All data is timestamped and queryable.
 */
export class AgentMemory implements AgentMemoryStore {
  constructor(
    private readonly repository: AgentRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async add(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry> {
    const record = MemoryEntryModel.build(entry, this.now);
    await this.repository.saveMemory(record);
    return record;
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.repository.queryMemory(query);
  }

  async latest(storeId: string, kind: MemoryEntry['kind'], key: string): Promise<MemoryEntry | null> {
    const results = await this.repository.queryMemory({ storeId, kind, key, limit: 1 });
    return results[0] ?? null;
  }

  recordHistory(params: RecordHistoryParams): Promise<MemoryEntry> {
    return this.add({
      storeId: params.storeId,
      agentId: params.agentId,
      workflowId: params.workflowId,
      kind: 'agent_history',
      key: `history:${params.result.taskId}`,
      data: {
        taskId: params.result.taskId,
        status: params.result.status,
        recommendationCount: params.result.recommendations.length,
        actionCount: params.result.actions.length,
        ruleIds: params.result.recommendations.map((recommendation) => recommendation.rule),
      },
    });
  }

  recordExecution(params: { storeId: string; agentId: string; run: AgentRunRecord }): Promise<MemoryEntry> {
    return this.add({
      storeId: params.storeId,
      agentId: params.agentId,
      workflowId: params.run.workflowId,
      kind: 'execution',
      key: `execution:${params.run.id}`,
      data: {
        runId: params.run.id,
        taskId: params.run.taskId,
        status: params.run.status,
        durationMs: params.run.durationMs,
        tokenEstimate: params.run.tokenEstimate,
        costEstimate: params.run.costEstimate,
      },
    });
  }

  recordPerformance(params: { storeId: string; agentId: string; run: AgentRunRecord }): Promise<MemoryEntry> {
    return this.add({
      storeId: params.storeId,
      agentId: params.agentId,
      workflowId: params.run.workflowId,
      kind: 'performance',
      key: `performance:${params.run.id}`,
      data: {
        runId: params.run.id,
        durationMs: params.run.durationMs,
        confidence: params.run.confidence,
        tokens: params.run.tokenEstimate,
        costEstimate: params.run.costEstimate,
      },
    });
  }

  async recordFeedback(params: RecordFeedbackParams): Promise<FeedbackRecord> {
    const record: FeedbackRecord = {
      id: newId(),
      storeId: params.storeId,
      agentId: params.agentId,
      taskId: params.taskId,
      ...(params.workflowId === undefined ? {} : { workflowId: params.workflowId }),
      rating: params.rating,
      ...(params.comment === undefined ? {} : { comment: params.comment }),
      createdAt: this.now(),
    };
    await this.repository.saveFeedback(record);
    return record;
  }

  async recordValidationFailure(params: RecordValidationFailureParams): Promise<ValidationFailureRecord> {
    const record: ValidationFailureRecord = {
      id: newId(),
      storeId: params.storeId,
      agentId: params.agentId,
      taskId: params.taskId,
      ...(params.workflowId === undefined ? {} : { workflowId: params.workflowId }),
      failures: params.failures,
      createdAt: this.now(),
    };
    await this.repository.saveValidationFailure(record);
    return record;
  }
}

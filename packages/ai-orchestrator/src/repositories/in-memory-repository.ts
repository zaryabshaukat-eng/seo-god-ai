import { NotFoundError } from '@seogod/core';
import type { ExecutionTrace, WorkflowExecution } from '../types/execution.js';
import type { MemoryEntry, MemoryQuery } from '../types/memory.js';
import type { OrchestratorRepository } from '../types/repository.js';
import type { WorkflowDefinition } from '../types/workflow.js';

/**
 * In-memory {@link OrchestratorRepository}. Complete and deterministic;
 * used as the default and across the test suite. Swap in a durable store
 * without changing any orchestrator logic.
 */
export class InMemoryOrchestratorRepository implements OrchestratorRepository {
  private readonly definitions = new Map<string, WorkflowDefinition>();
  private readonly executions = new Map<string, WorkflowExecution>();
  private readonly traces = new Map<string, ExecutionTrace>();
  private readonly memory: MemoryEntry[] = [];
  private readonly checkpoints = new Map<string, WorkflowExecution>();

  async saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void> {
    this.definitions.set(definition.id, definition);
  }

  async getWorkflowDefinition(id: string): Promise<WorkflowDefinition | null> {
    return this.definitions.get(id) ?? null;
  }

  async saveExecution(execution: WorkflowExecution): Promise<void> {
    this.executions.set(execution.id, execution);
  }

  async getExecution(id: string): Promise<WorkflowExecution | null> {
    return this.executions.get(id) ?? null;
  }

  async listExecutions(storeId?: string, limit = 100): Promise<WorkflowExecution[]> {
    const all = [...this.executions.values()]
      .filter((execution) => storeId === undefined || execution.storeId === storeId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return all.slice(0, Math.max(0, limit));
  }

  async saveTrace(trace: ExecutionTrace): Promise<void> {
    this.traces.set(trace.executionId, trace);
  }

  async getTrace(executionId: string): Promise<ExecutionTrace | null> {
    return this.traces.get(executionId) ?? null;
  }

  async addMemory(entry: MemoryEntry): Promise<void> {
    this.memory.push(entry);
  }

  async queryMemory(query: MemoryQuery): Promise<MemoryEntry[]> {
    let results = this.memory;
    if (query.storeId !== undefined) results = results.filter((e) => e.storeId === query.storeId);
    if (query.agentId !== undefined) results = results.filter((e) => e.agentId === query.agentId);
    if (query.kind !== undefined) results = results.filter((e) => e.kind === query.kind);
    if (query.key !== undefined) results = results.filter((e) => e.key === query.key);
    if (query.before !== undefined) results = results.filter((e) => e.createdAt < (query.before as Date));
    results = [...results].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (query.limit !== undefined && query.limit > 0) results = results.slice(0, query.limit);
    return results;
  }

  async saveCheckpoint(execution: WorkflowExecution): Promise<void> {
    this.checkpoints.set(execution.id, execution);
  }

  async getCheckpoint(id: string): Promise<WorkflowExecution | null> {
    const checkpoint = this.checkpoints.get(id);
    if (checkpoint === undefined) {
      const stored = await this.getExecution(id);
      return stored;
    }
    return checkpoint;
  }

  async requireExecution(id: string): Promise<WorkflowExecution> {
    const execution = await this.getExecution(id);
    if (execution === null) {
      throw new NotFoundError(`Workflow execution "${id}" was not found`, {
        module: 'ai-orchestrator',
        operation: 'repository.getExecution',
      });
    }
    return execution;
  }
}

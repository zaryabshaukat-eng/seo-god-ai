/**
 * Persistence abstraction. The repository keeps workflow executions, traces,
 * checkpoints, and memory entries. An in-memory implementation is provided;
 * callers may plug in a durable store without changing orchestrator logic.
 */

import type { ExecutionTrace, WorkflowExecution } from './execution.js';
import type { MemoryEntry, MemoryQuery } from './memory.js';
import type { WorkflowDefinition } from './workflow.js';

export interface OrchestratorRepository {
  saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void>;
  getWorkflowDefinition(id: string): Promise<WorkflowDefinition | null>;
  saveExecution(execution: WorkflowExecution): Promise<void>;
  getExecution(id: string): Promise<WorkflowExecution | null>;
  listExecutions(storeId?: string, limit?: number): Promise<WorkflowExecution[]>;
  saveTrace(trace: ExecutionTrace): Promise<void>;
  getTrace(executionId: string): Promise<ExecutionTrace | null>;
  addMemory(entry: MemoryEntry): Promise<void>;
  queryMemory(query: MemoryQuery): Promise<MemoryEntry[]>;
  /** Persist a checkpoint; `execution.checkpointedAt` marks the progress point. */
  saveCheckpoint(execution: WorkflowExecution): Promise<void>;
  getCheckpoint(id: string): Promise<WorkflowExecution | null>;
}

/**
 * Persistent memory types. The memory store keeps conversation history,
 * execution history, tool outputs, agent outputs, and validation results.
 */

export type MemoryKind =
  | 'conversation'
  | 'execution'
  | 'tool-output'
  | 'agent-output'
  | 'validation';

export interface MemoryEntry {
  id: string;
  storeId: string;
  workflowId?: string;
  agentId?: string;
  taskId?: string;
  kind: MemoryKind;
  /** Stable key for grouping (e.g. `rule:missing-title`). */
  key: string;
  /** JSON-safe payload. */
  data: Record<string, unknown>;
  createdAt: Date;
}

export interface MemoryQuery {
  storeId?: string;
  agentId?: string;
  kind?: MemoryKind;
  key?: string;
  limit?: number;
  before?: Date;
}

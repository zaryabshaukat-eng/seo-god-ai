import type { AgentRisk, AgentStatus } from './output.js';
import type { ValidationFailure } from './validation.js';

export type MemoryKind =
  | 'agent_history'
  | 'execution'
  | 'feedback'
  | 'validation_failure'
  | 'performance';

export interface MemoryEntry {
  id: string;
  storeId: string;
  agentId: string;
  workflowId?: string;
  kind: MemoryKind;
  key: string;
  data: Record<string, unknown>;
  createdAt: Date;
}

export interface MemoryQuery {
  storeId?: string;
  agentId?: string;
  workflowId?: string;
  kind?: MemoryKind;
  key?: string;
  limit?: number;
}

export interface AgentRunRecord {
  id: string;
  agentId: string;
  name: string;
  version: string;
  taskId: string;
  workflowId: string;
  storeId: string;
  status: AgentStatus | 'FAILED';
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  tokenEstimate: number;
  costEstimate: number;
  confidence: number;
  risk: AgentRisk;
  recommendationCount: number;
  actionCount: number;
  model?: string;
  error?: string;
}

export interface FeedbackRecord {
  id: string;
  storeId: string;
  agentId: string;
  taskId: string;
  workflowId?: string;
  rating: number;
  comment?: string;
  createdAt: Date;
}

export interface ValidationFailureRecord {
  id: string;
  storeId: string;
  agentId: string;
  taskId: string;
  workflowId?: string;
  failures: ValidationFailure[];
  createdAt: Date;
}

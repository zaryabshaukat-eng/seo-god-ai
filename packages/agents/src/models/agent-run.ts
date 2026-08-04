import type { AgentRunRecord } from '../types/memory.js';
import type { AgentRisk, AgentStatus } from '../types/output.js';
import { newId } from '../utils/ids.js';

export interface BuildAgentRunOptions {
  id?: string;
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

/** Deterministic construction of an agent run record. */
export const AgentRunModel = {
  build(options: BuildAgentRunOptions): AgentRunRecord {
    return {
      id: options.id ?? newId(),
      agentId: options.agentId,
      name: options.name,
      version: options.version,
      taskId: options.taskId,
      workflowId: options.workflowId,
      storeId: options.storeId,
      status: options.status,
      startedAt: options.startedAt,
      completedAt: options.completedAt,
      durationMs: options.durationMs,
      tokenEstimate: options.tokenEstimate,
      costEstimate: options.costEstimate,
      confidence: options.confidence,
      risk: options.risk,
      recommendationCount: options.recommendationCount,
      actionCount: options.actionCount,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.error === undefined ? {} : { error: options.error }),
    };
  },
};

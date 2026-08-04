import type { AgentStatus, Severity } from './output.js';

export type AgentEventType =
  | 'agent.registered'
  | 'agent.invoked'
  | 'agent.completed'
  | 'agent.failed'
  | 'recommendation.generated'
  | 'recommendation.rejected';

interface AgentEventFields {
  agentId: string;
  agentName: string;
  version: string;
}

export type AgentEvent =
  | (AgentEventFields & { type: 'agent.registered'; capabilities: string[] })
  | (AgentEventFields & {
      type: 'agent.invoked';
      taskId: string;
      workflowId: string;
      storeId: string;
    })
  | (AgentEventFields & {
      type: 'agent.completed';
      taskId: string;
      workflowId: string;
      storeId: string;
      status: AgentStatus;
      durationMs: number;
      tokenEstimate: number;
      costEstimate: number;
      recommendationCount: number;
      actionCount: number;
      confidence: number;
    })
  | (AgentEventFields & {
      type: 'agent.failed';
      taskId: string;
      workflowId: string;
      storeId: string;
      error: string;
      retryable: boolean;
    })
  | (AgentEventFields & {
      type: 'recommendation.generated';
      taskId: string;
      workflowId: string;
      storeId: string;
      rule: string;
      severity: Severity;
      confidence: number;
      estimatedImpact: number;
    })
  | (AgentEventFields & {
      type: 'recommendation.rejected';
      taskId: string;
      workflowId: string;
      storeId: string;
      rule: string;
      reason: string;
    });

/** Publish sink used by the service; a no-op bus is substituted in tests. */
export interface AgentSink {
  emit(event: AgentEvent): Promise<void>;
}

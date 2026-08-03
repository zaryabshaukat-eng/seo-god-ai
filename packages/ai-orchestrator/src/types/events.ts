/**
 * Orchestrator event payloads. The orchestrator publishes these onto the
 * outbox event bus; internal trace events are recorded separately.
 */

import type { WorkflowStatus } from './workflow.js';

export interface WorkflowStartedEvent {
  workflowId: string;
  definitionId: string;
  definitionVersion: number;
  name: string;
  storeId: string;
}

export interface WorkflowCompletedEvent {
  workflowId: string;
  name: string;
  status: Extract<WorkflowStatus, 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT'>;
  storeId: string;
  durationMs: number;
  totalTokens: number;
  costEstimate: number;
}

export interface AgentStartedEvent {
  workflowId: string;
  stepId: string;
  taskId: string;
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
}

export interface AgentCompletedEvent extends AgentStartedEvent {
  latencyMs: number;
  totalTokens: number;
  costEstimate: number;
}

export interface AgentFailedEvent extends AgentStartedEvent {
  error: string;
  retryable: boolean;
  attempt: number;
}

export interface ValidationFailedEvent {
  workflowId: string;
  stepId: string;
  taskId: string;
  agentId: string;
  issues: string[];
}

export type OrchestratorEvent =
  | ({ type: 'workflow.started' } & WorkflowStartedEvent)
  | ({ type: 'workflow.completed' } & WorkflowCompletedEvent)
  | ({ type: 'workflow.failed' } & WorkflowCompletedEvent)
  | ({ type: 'agent.started' } & AgentStartedEvent)
  | ({ type: 'agent.completed' } & AgentCompletedEvent)
  | ({ type: 'agent.failed' } & AgentFailedEvent)
  | ({ type: 'validation.failed' } & ValidationFailedEvent);

/** Optional consumer of orchestrator events (event bus, metrics, logging). */
export interface EventSink {
  emit(event: OrchestratorEvent): Promise<void> | void;
  /** Record a validation failure outcome (used by the agent runner). */
  validationFailed?(event: ValidationFailedEvent): void;
}

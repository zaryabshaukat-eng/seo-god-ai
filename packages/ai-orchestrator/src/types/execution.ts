/**
 * Execution records: per-agent executions, per-step executions, workflow
 * executions, execution traces, and the final execution report.
 */

import type { AgentResult } from './agent.js';
import type { StepStatus, WorkflowStatus, WorkflowStepKind } from './workflow.js';

export type AgentExecutionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** Record of a single provider-backed agent call (one attempt). */
export interface AgentExecution {
  id: string;
  taskId: string;
  stepId: string;
  agentId: string;
  workflowId: string;
  storeId: string;
  provider: string;
  model: string;
  status: AgentExecutionStatus;
  attempt: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costEstimate: number;
  latencyMs: number;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

/** Record of one workflow step execution (across all its attempts). */
export interface StepExecution {
  id: string;
  stepId: string;
  kind: WorkflowStepKind;
  status: StepStatus;
  attempt: number;
  /** Set when the step ran an agent. */
  agentExecutionId?: string;
  error: string | null;
  /** For conditional steps, which branch ran (`true`/`false`). */
  branchTaken?: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** A running or finished workflow instance. */
export interface WorkflowExecution {
  id: string;
  definitionId: string;
  definitionVersion: number;
  name: string;
  storeId: string;
  status: WorkflowStatus;
  inputs: Record<string, unknown>;
  /** Step outputs keyed by step id. */
  outputs: Record<string, AgentResult>;
  steps: StepExecution[];
  startedAt: Date;
  completedAt: Date | null;
  error: string | null;
  /** Set when the workflow was cancelled. */
  cancelledAt: Date | null;
  /** Last time the workflow was checkpointed. */
  checkpointedAt: Date | null;
}

export interface TraceEvent {
  id: string;
  executionId: string;
  type: string;
  stepId?: string;
  attempt?: number;
  data?: Record<string, unknown>;
  at: Date;
}

/** Append-only lifecycle log for a workflow execution. */
export interface ExecutionTrace {
  id: string;
  executionId: string;
  events: TraceEvent[];
}

export interface FailureDetail {
  stepId: string;
  name: string;
  attempt: number;
  error: string;
  retryable: boolean;
}

export interface ExecutionReport {
  executionId: string;
  workflowName: string;
  status: WorkflowStatus;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  steps: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    skipped: number;
  };
  failures: FailureDetail[];
  agentResults: AgentResult[];
  totalTokens: number;
  costEstimate: number;
}

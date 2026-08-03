/**
 * Workflow definition types. A workflow is a JSON-serializable, versioned
 * template of steps (agent, sequential, parallel, conditional). It is the
 * plan the planner produces from a decision-engine ExecutionPlan and the
 * workflow engine executes.
 */

import type { ValidationSchema } from './validation.js';

export type WorkflowStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export type StepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export type WorkflowStepKind = 'agent' | 'sequential' | 'parallel' | 'conditional';

/** Data-driven condition evaluated against step outputs by path. */
export interface WorkflowCondition {
  /** Output path, e.g. `steps.step-a.data.status`. */
  key: string;
  operator: 'eq' | 'ne' | 'exists' | 'not_exists' | 'gt' | 'lt' | 'contains';
  value?: unknown;
}

interface WorkflowStepBase {
  id: string;
  name?: string;
  /** Sibling step ids that must complete (with success) first. */
  dependsOn?: string[];
  /** Per-step retry budget (overrides the definition default). */
  maxAttempts?: number;
  /** Per-step timeout (overrides the definition default). */
  timeoutMs?: number;
}

export interface AgentWorkflowStep extends WorkflowStepBase {
  kind: 'agent';
  agentId: string;
  /** Prompt-template params describing what to do. */
  taskTemplate: string;
  /** Structured output contract for this step. */
  schema?: ValidationSchema;
  /** Action types the plan authorizes (safety gate). */
  allowedActions?: string[];
}

export interface SequentialGroup extends WorkflowStepBase {
  kind: 'sequential';
  steps: WorkflowStep[];
}

export interface ParallelGroup extends WorkflowStepBase {
  kind: 'parallel';
  steps: WorkflowStep[];
  maxConcurrency?: number;
}

export interface ConditionalStep extends WorkflowStepBase {
  kind: 'conditional';
  condition: WorkflowCondition;
  whenTrue: WorkflowStep[];
  whenFalse: WorkflowStep[];
}

export type WorkflowStep =
  | AgentWorkflowStep
  | SequentialGroup
  | ParallelGroup
  | ConditionalStep;

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: number;
  steps: WorkflowStep[];
  /** Overall workflow timeout in ms (0 = none). */
  timeoutMs?: number;
  defaultMaxAttempts?: number;
}

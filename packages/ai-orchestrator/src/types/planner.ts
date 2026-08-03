/**
 * Planner output types. The planner converts a decision-engine ExecutionPlan
 * into a deterministic {@link AgentWorkflow} the workflow engine can run.
 */

import type { WorkflowDefinition } from './workflow.js';

export interface AgentWorkflow {
  definition: WorkflowDefinition;
  /** Agent resolved per step id. */
  assignments: Record<string, string>;
  /** Provenance of the workflow. */
  source: {
    planId: string;
    decisionId: string;
    storeId: string;
    taskCount: number;
  };
}

export interface PlanWorkflowOptions {
  /** Override the agent-resolution strategy (defaults to capability match). */
  resolveAgent?: (task: { actionType: string; rule: string; resourceType: string }) => string;
  /** Parallelism per batch (defaults to the batch task count). */
  batchConcurrency?: number;
}

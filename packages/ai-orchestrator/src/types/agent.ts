/**
 * Agent registration types. Every agent exposes a stable identity plus the
 * capabilities the registry uses to route tasks deterministically.
 */

import type { PromptContext } from './context.js';
import type { ValidationSchema } from './validation.js';

export interface AgentHealth {
  status: 'ok' | 'degraded' | 'down';
  lastCheckedAt?: Date;
  detail?: string;
}

export interface AgentDefinition {
  /** Stable machine id, e.g. `on-page-content-writer`. */
  id: string;
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  /** Agent-task kinds this agent handles, e.g. `update_title`. */
  supportedTasks: string[];
  /** Max parallel executions allowed for this agent. */
  maxConcurrency: number;
  /** Lower values run first when several agents can handle a task. */
  priority: number;
  health: AgentHealth;
  /** Provider + model the agent runs on. */
  provider: string;
  model: string;
}

/** A single agent invocation produced by the planner or workflow engine. */
export interface AgentTask {
  id: string;
  workflowId: string;
  stepId: string;
  agentId: string;
  name: string;
  /** Natural-language or structured instructions for the agent. */
  description: string;
  /** Task-level input merged into the prompt context. */
  input: Record<string, unknown>;
  /** Prompt context assembled by the context builder. */
  context: PromptContext;
  /** Provider + model stamped by the task factory (for execution records). */
  provider?: string;
  model?: string;
  /** Output schema the agent response must satisfy. */
  expectedSchema?: ValidationSchema;
  /** Action types the plan authorizes for this task (safety gate). */
  allowedActions?: string[];
  maxAttempts?: number;
  timeoutMs?: number;
}

/** A validated agent response ready for the workflow to consume. */
export interface AgentResult {
  taskId: string;
  stepId: string;
  agentId: string;
  workflowId: string;
  /** Raw completion text. */
  text: string;
  /** Parsed + validated structured payload, when a schema was enforced. */
  data: Record<string, unknown> | null;
  tokens: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Estimated USD cost of the call. */
  costEstimate: number;
  latencyMs: number;
  provider: string;
  model: string;
  completedAt: Date;
}

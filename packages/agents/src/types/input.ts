import type { AgentResourceType } from './output.js';

/** A single entity (product, page, ...) an agent analyzes. */
export interface AgentEntityInput {
  id: string;
  type: AgentResourceType | string;
  /** Stable reference, e.g. the canonical URL or platform id. */
  ref: string;
  data: Record<string, unknown>;
}

/** The minimum input every agent requires to run. */
export interface AgentInput {
  storeId: string;
  workflowId: string;
  taskId: string;
  entities: AgentEntityInput[];
  /** Auxiliary context (e.g. other agents' results for reporting/analytics). */
  context?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

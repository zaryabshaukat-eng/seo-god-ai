export interface ContextSection {
  id: string;
  kind: string;
  content: unknown;
  size: number;
  truncated: boolean;
}

/**
 * The compressed context handed to (and recorded around) an agent run. Only
 * the minimal data the agent needs survives compression; large payloads are
 * truncated deterministically to respect token budgets.
 */
export interface AgentContext {
  agentId: string;
  taskId: string;
  workflowId: string;
  storeId: string;
  sections: ContextSection[];
  tokenEstimate: number;
}

export interface ContextBudget {
  maxTokens?: number;
  maxSectionTokens?: number;
}

import type { JsonSchema } from './schema.js';
import type { AgentActionType, AgentResourceType } from './output.js';

export type AgentHealthStatus = 'ok' | 'degraded' | 'down';

export interface AgentHealth {
  status: AgentHealthStatus;
  lastCheckedAt: Date;
  detail?: string;
}

/**
 * Public description of an agent. Every field is stable and immutable except
 * `health`, which the orchestrator/service updates during runtime.
 */
export interface AgentDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  supportedTasks: string[];
  supportedEntities: AgentResourceType[];
  supportedActionTypes: AgentActionType[];
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  health: AgentHealth;
}

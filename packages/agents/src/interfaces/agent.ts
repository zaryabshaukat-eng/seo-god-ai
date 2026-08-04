import type { AgentDefinition, AgentHealth } from '../types/agent.js';
import type { AgentInput } from '../types/input.js';
import type { AgentActionType, AgentResourceType, AgentResult } from '../types/output.js';
import type { JsonSchema } from '../types/schema.js';

/**
 * The contract every agent implements. Metadata is stable and immutable; the
 * only mutable state is `health`. `analyze` must be deterministic and pure.
 */
export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly capabilities: string[];
  readonly supportedTasks: string[];
  readonly supportedEntities: AgentResourceType[];
  readonly supportedActionTypes: AgentActionType[];
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly promptId: string;
  health: AgentHealth;
  definition(): AgentDefinition;
  analyze(input: AgentInput): AgentResult;
}

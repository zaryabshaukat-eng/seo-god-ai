import type { Agent } from '../interfaces/agent.js';
import { AGENT_INPUT_SCHEMA, AGENT_OUTPUT_SCHEMA } from '../base/agent-schemas.js';
import type { AgentEntityInput, AgentInput } from '../types/input.js';
import type { AgentActionType, AgentResourceType, AgentResult } from '../types/output.js';

/** Minimal contract-conformant input factory. */
export function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    storeId: 'store-1',
    workflowId: 'workflow-1',
    taskId: 'task-1',
    entities: [],
    ...overrides,
  };
}

export function makeEntity(overrides: Partial<AgentEntityInput> = {}): AgentEntityInput {
  return {
    id: 'entity-1',
    type: 'page',
    ref: 'https://acme.example/p/1',
    data: {},
    ...overrides,
  };
}

/** A stubbed agent for validator/service tests that returns a fixed result. */
export class StubAgent implements Agent {
  readonly id: string;
  readonly name: string;
  readonly version = '1.0.0';
  readonly description = 'Stub agent for tests.';
  readonly capabilities = ['stub'];
  readonly supportedTasks = ['stub'];
  readonly supportedEntities: AgentResourceType[] = ['page'];
  readonly supportedActionTypes: AgentActionType[] = ['update_title'];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'metadata';
  health = { status: 'ok' as const, lastCheckedAt: new Date('2026-01-01T00:00:00.000Z') };

  constructor(id: string, private readonly resultFactory: (input: AgentInput) => AgentResult) {
    this.id = id;
    this.name = id;
  }

  definition() {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: this.description,
      capabilities: [...this.capabilities],
      supportedTasks: [...this.supportedTasks],
      supportedEntities: [...this.supportedEntities],
      supportedActionTypes: [...this.supportedActionTypes],
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
      health: { ...this.health, lastCheckedAt: new Date(this.health.lastCheckedAt) },
    };
  }

  analyze(input: AgentInput): AgentResult {
    return this.resultFactory(input);
  }
}

/** Builds a valid, schema-conformant result bound to the given agent id/task. */
export function makeResult(
  agentId: string,
  taskId: string,
  overrides: Partial<AgentResult> = {},
): AgentResult {
  return {
    agentId,
    taskId,
    status: 'SUCCESS',
    recommendations: [],
    actions: [],
    confidence: 0.9,
    risk: 'LOW',
    evidence: [],
    estimatedImpact: 0,
    dependencies: [],
    warnings: [],
    executionHints: [],
    ...overrides,
  };
}

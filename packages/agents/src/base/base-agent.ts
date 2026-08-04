import type { Agent } from '../interfaces/agent.js';
import type { AgentDefinition, AgentHealth } from '../types/agent.js';
import type { AgentEntityInput, AgentInput } from '../types/input.js';
import type {
  AgentAction,
  AgentActionType,
  AgentRecommendation,
  AgentResourceType,
  AgentResult,
  AgentRisk,
  AgentStatus,
  ImplementationDifficulty,
  RecommendationEvidence,
  Severity,
} from '../types/output.js';
import type { JsonSchema } from '../types/schema.js';

const RISK_ORDER: Record<AgentRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export interface RecommendationOptions {
  rule: string;
  title: string;
  summary: string;
  reason: string;
  severity?: Severity;
  confidence?: number;
  estimatedImpact?: number;
  risk?: AgentRisk;
  implementationDifficulty?: ImplementationDifficulty;
  expectedExecutionTime?: string;
  rollbackPossible?: boolean;
  approvalRequired?: boolean;
  evidence?: RecommendationEvidence[];
  affectedUrls?: string[];
}

export interface ActionOptions {
  actionType: AgentActionType;
  resourceType: AgentResourceType;
  resourceId: string;
  resourceRef: string;
  payload: Record<string, unknown>;
  priority?: number;
  estimatedSeconds?: number;
  rationale?: string;
}

export interface ResultOptions {
  input: AgentInput;
  status?: AgentStatus;
  recommendations?: AgentRecommendation[];
  actions?: AgentAction[];
  confidence?: number;
  risk?: AgentRisk;
  evidence?: RecommendationEvidence[];
  estimatedImpact?: number;
  dependencies?: string[];
  warnings?: string[];
  executionHints?: string[];
}

/**
 * Base for all specialist agents. Subclasses declare immutable metadata and a
 * deterministic `analyze`; this class provides the shared builders so every
 * agent returns contract-conformant results.
 */
export abstract class BaseAgent implements Agent {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly description: string;
  abstract readonly capabilities: string[];
  abstract readonly supportedTasks: string[];
  abstract readonly supportedEntities: AgentResourceType[];
  abstract readonly supportedActionTypes: AgentActionType[];
  abstract readonly inputSchema: JsonSchema;
  abstract readonly outputSchema: JsonSchema;
  abstract readonly promptId: string;
  health: AgentHealth = { status: 'ok', lastCheckedAt: new Date() };

  abstract analyze(input: AgentInput): AgentResult;

  definition(): AgentDefinition {
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

  /** Stable rule id for a named rule within this agent. */
  protected rule(name: string): string {
    return `${this.id}.${name}`;
  }

  // --- Entity/data accessors ---

  protected entitiesOfType(input: AgentInput, type: string): AgentEntityInput[] {
    return input.entities.filter((entity) => entity.type === type);
  }

  protected entityOfType(input: AgentInput, type: string): AgentEntityInput | undefined {
    return input.entities.find((entity) => entity.type === type);
  }

  protected stringValue(data: Record<string, unknown>, key: string): string | undefined {
    const value = data[key];
    return typeof value === 'string' ? value : undefined;
  }

  protected numberValue(data: Record<string, unknown>, key: string): number | undefined {
    const value = data[key];
    return typeof value === 'number' ? value : undefined;
  }

  protected booleanValue(data: Record<string, unknown>, key: string): boolean | undefined {
    const value = data[key];
    return typeof value === 'boolean' ? value : undefined;
  }

  protected listValue(data: Record<string, unknown>, key: string): unknown[] {
    const value = data[key];
    return Array.isArray(value) ? value : [];
  }

  protected evidenceFor(
    entity: AgentEntityInput,
    field: string,
    value: string | number | boolean | null,
  ): RecommendationEvidence {
    return { url: entity.ref, field, value };
  }

  // --- Builders ---

  protected buildRecommendation(options: RecommendationOptions): AgentRecommendation {
    return {
      rule: options.rule,
      title: options.title,
      summary: options.summary,
      reason: options.reason,
      evidence: options.evidence ?? [],
      severity: options.severity ?? 'MEDIUM',
      confidence: options.confidence ?? 0.7,
      estimatedImpact: options.estimatedImpact ?? 50,
      risk: options.risk ?? 'LOW',
      implementationDifficulty: options.implementationDifficulty ?? 'LOW',
      expectedExecutionTime: options.expectedExecutionTime ?? '1 hour',
      rollbackPossible: options.rollbackPossible ?? true,
      approvalRequired: options.approvalRequired ?? false,
      affectedUrls: options.affectedUrls ?? [],
    };
  }

  protected buildAction(options: ActionOptions): AgentAction {
    return {
      actionType: options.actionType,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      resourceRef: options.resourceRef,
      payload: options.payload,
      priority: options.priority ?? 50,
      estimatedSeconds: options.estimatedSeconds ?? 600,
      rationale: options.rationale ?? '',
    };
  }

  /** Assembles a contract-conformant result, deriving defaults from its parts. */
  protected result(options: ResultOptions): AgentResult {
    const recommendations = options.recommendations ?? [];
    const actions = options.actions ?? [];
    const confidence =
      options.confidence ??
      (recommendations.length === 0
        ? 0.9
        : round(recommendations.reduce((total, r) => total + r.confidence, 0) / recommendations.length));
    const risk =
      options.risk ??
      (recommendations.length === 0
        ? 'LOW'
        : recommendations.reduce<AgentRisk>(
            (max, r) => (RISK_ORDER[r.risk] > RISK_ORDER[max] ? r.risk : max),
            'LOW',
          ));
    const estimatedImpact =
      options.estimatedImpact ??
      (recommendations.length === 0
        ? 0
        : Math.max(...recommendations.map((recommendation) => recommendation.estimatedImpact)));
    return {
      agentId: this.id,
      taskId: options.input.taskId,
      status: options.status ?? 'SUCCESS',
      recommendations,
      actions,
      confidence,
      risk,
      evidence: options.evidence ?? [],
      estimatedImpact,
      dependencies: options.dependencies ?? [],
      warnings: options.warnings ?? [],
      executionHints: options.executionHints ?? [],
    };
  }
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

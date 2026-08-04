export type AgentStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type AgentRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export type ImplementationDifficulty = 'TRIVIAL' | 'LOW' | 'MEDIUM' | 'HIGH';

/** Resource types the platform understands (mirrors the decision engine). */
export const KNOWN_RESOURCE_TYPES = [
  'product',
  'collection',
  'page',
  'blog',
  'article',
  'store',
] as const;
export type AgentResourceType = (typeof KNOWN_RESOURCE_TYPES)[number];

/** Action types agents are allowed to propose (mirrors the decision engine). */
export const KNOWN_ACTION_TYPES = [
  'update_title',
  'update_meta_description',
  'update_description',
  'update_body',
  'update_url',
  'update_meta',
  'add_structured_data',
  'remove_structured_data',
  'fix_internal_links',
  'add_internal_links',
  'remove_internal_links',
  'update_alt_text',
  'add_image',
  'remove_image',
  'update_robots',
  'update_canonical',
  'remove_redirect',
  'create_page',
  'delete_page',
  'update_collection',
  'update_product',
  'update_blog',
  'update_article',
  'custom',
] as const;
export type AgentActionType = (typeof KNOWN_ACTION_TYPES)[number];

export interface RecommendationEvidence {
  url: string;
  field: string;
  value: string | number | boolean | null;
  snippet?: string;
}

/**
 * A single, actionable recommendation. Everything an agent proposes must be
 * backed by evidence from the input and carry a stable rule id.
 */
export interface AgentRecommendation {
  rule: string;
  title: string;
  summary: string;
  reason: string;
  evidence: RecommendationEvidence[];
  severity: Severity;
  confidence: number;
  estimatedImpact: number;
  risk: AgentRisk;
  implementationDifficulty: ImplementationDifficulty;
  expectedExecutionTime: string;
  rollbackPossible: boolean;
  approvalRequired: boolean;
  affectedUrls: string[];
}

/** A concrete, safe change the agent would like to propose downstream. */
export interface AgentAction {
  actionType: AgentActionType;
  resourceType: AgentResourceType;
  resourceId: string;
  resourceRef: string;
  payload: Record<string, unknown>;
  priority: number;
  estimatedSeconds: number;
  rationale: string;
}

/**
 * The strict, schema-validated output contract every agent returns. Agents
 * never execute changes; they return recommendations and proposed actions
 * that the decision engine/validation layer must approve before any work.
 */
export interface AgentResult {
  agentId: string;
  taskId: string;
  status: AgentStatus;
  recommendations: AgentRecommendation[];
  actions: AgentAction[];
  confidence: number;
  risk: AgentRisk;
  evidence: RecommendationEvidence[];
  estimatedImpact: number;
  dependencies: string[];
  warnings: string[];
  executionHints: string[];
}

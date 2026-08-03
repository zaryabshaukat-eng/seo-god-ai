/**
 * Prompt-context types. The context builder assembles the minimal context an
 * agent needs for one task: knowledge-graph facts, SEO issues, prioritized
 * recommendations, historical outcomes, store metadata, and configuration.
 */

export type ContextSectionKind =
  | 'knowledge-graph'
  | 'seo-issues'
  | 'recommendations'
  | 'historical-outcomes'
  | 'store-metadata'
  | 'configuration'
  | 'task';

/** One bounded slice of context fed to an agent. */
export interface ContextSection {
  id: string;
  kind: ContextSectionKind;
  /** JSON-safe content. */
  content: unknown;
  /** Approximate token count of the rendered content. */
  size: number;
  /** True when the section was truncated to fit the budget. */
  truncated: boolean;
}

export interface PromptContext {
  taskId: string;
  agentId: string;
  storeId: string;
  sections: ContextSection[];
  /** Aggregate approximate token count of all sections. */
  tokenEstimate: number;
}

/** Raw context sources consumed by the context builder. */
export interface ContextSources {
  storeId: string;
  storeMetadata?: {
    name?: string;
    domain?: string;
    platform?: string;
    currency?: string;
  };
  /** Normalized knowledge-graph facts (decision-engine GraphContext shape). */
  graph?: {
    snapshotId: string;
    pageCount: number;
    orphanPages: Array<{ id: string; url: string; type: string; inLinks: number }>;
    topicClusters: unknown[];
    contentGaps: unknown[];
    duplicateTargets: unknown[];
  } | null;
  seoIssues?: Array<{ url: string; rule: string; severity?: string; message?: string }>;
  recommendations?: Array<{
    id: string;
    rule: string;
    priority: string;
    score: number;
    title: string;
    description: string;
    recommendedAction: string;
    affectedUrls: string[];
  }>;
  historicalOutcomes?: Array<{
    rule: string;
    attempts: number;
    successes: number;
    averageImpact: number;
  }>;
  featureFlags?: Record<string, boolean>;
  settings?: Record<string, unknown>;
}

export interface ContextBudget {
  /** Approximate max tokens across all sections (0 = unlimited). */
  maxTokens?: number;
  /** Max tokens per section (0 = unlimited). */
  maxSectionTokens?: number;
}

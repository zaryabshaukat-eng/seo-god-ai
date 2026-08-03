import type { Recommendation } from '@seogod/seo-engine';
import type { ContentGap, DuplicateTarget, OrphanPage, TopicCluster } from '@seogod/knowledge-graph';
import type { DecisionSource } from './decision-source.js';

/**
 * The normalized inputs the decision engine consumes. The engine is fully
 * deterministic: no AI, no hidden I/O — everything below is either persisted
 * with the decision or derived by rule.
 */

/** A recommendation admitted to a decision (the seo-engine contract). */
export type DecisionRecommendation = Recommendation;

export type RiskTolerance = 'conservative' | 'balanced' | 'aggressive';

export type ApprovalMode = 'auto' | 'review';

export interface StoreSettings {
  storeId: string;
  /** Baseline approval posture for generated plans. */
  approvalMode: ApprovalMode;
  /** Risk appetite: shifts thresholds for approval/execution policy. */
  riskTolerance: RiskTolerance;
  /** Maximum tasks per execution batch. */
  maxBatchSize: number;
  /** Guardrail: maximum changes allowed against one resource per plan. */
  maxChangesPerResource: number;
  /** Cap on recommendations admitted into a plan (null = unlimited). */
  planCapRecommendations: number | null;
}

export interface HistoricalOutcome {
  /** Rule id, e.g. `missing-title`. */
  rule: string;
  /** Number of prior executions of this rule. */
  attempts: number;
  /** Number of prior executions that measurably improved SEO. */
  successes: number;
  /** Average measured SEO impact of prior executions (0..100). */
  averageImpact: number;
}

export interface FeatureFlags {
  [key: string]: boolean;
}

/** Normalized knowledge-graph output consumed by the planner. */
export interface GraphContext {
  snapshotId: string;
  pageCount: number;
  orphanPages: OrphanPage[];
  topicClusters: TopicCluster[];
  contentGaps: ContentGap[];
  duplicateTargets: DuplicateTarget[];
}

/** Everything the engine knows when a decision is made. */
export interface DecisionContext {
  storeSettings: StoreSettings;
  featureFlags: FeatureFlags;
  historicalOutcomes: HistoricalOutcome[];
  graph: GraphContext | null;
  /** Actor that requested the decision (used on approval requests). */
  requestedBy: string;
}

/** Top-level input to {@link DecisionEngineService.createDecision}. */
export interface DecisionEngineInput {
  storeId: string;
  source?: DecisionSource;
  recommendations: DecisionRecommendation[];
  storeSettings: StoreSettings;
  featureFlags: FeatureFlags;
  historicalOutcomes?: HistoricalOutcome[];
  graph?: GraphContext | null;
  requestedBy?: string;
}

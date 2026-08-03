import type { Recommendation } from '@seogod/seo-engine';
import type { DecisionContext } from './input.js';
import type { DecisionSource } from './decision-source.js';

export type { DecisionSource } from './decision-source.js';

/**
 * Core decision types. A {@link Decision} captures "this store should act on
 * these recommendations" together with the full deterministic context that
 * produced it, so planning and re-planning are reproducible from the record.
 */

export type DecisionStatus =
  | 'PENDING'
  | 'PLANNED'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK';

/** Aggregated, deterministic summary of a decision and its plan. */
export interface DecisionSummary {
  /** Number of source recommendations considered. */
  recommendationCount: number;
  /** Number of execution tasks derived. */
  taskCount: number;
  /** Number of execution batches. */
  batchCount: number;
  /** Estimated wall-clock execution time in minutes. */
  estimatedExecutionMinutes: number;
  /** Total estimated engineering effort in hours. */
  totalEffortHours: number;
  /** Aggregate SEO impact estimate (0..100). */
  totalImpact: number;
  /** Tasks classified as high risk. */
  highRiskTaskCount: number;
  /** Whether plan approval is required before execution. */
  approvalRequired: boolean;
}

export interface Decision {
  /** Deterministic id: uuid5('decision', storeId + source + sorted rec ids). */
  id: string;
  storeId: string;
  source: DecisionSource;
  status: DecisionStatus;
  /** Aggregated priority score 0..100. */
  score: number;
  /** Stable recommendation ids that feed the decision (sorted). */
  recommendationIds: string[];
  /** Source recommendations snapshot (JSON-safe). */
  recommendations: Recommendation[];
  /** The deterministic context the decision was made in. */
  context: DecisionContext;
  summary: DecisionSummary;
  /** Id of the current execution plan, when one exists. */
  planId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

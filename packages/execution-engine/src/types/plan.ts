/**
 * Engine inputs. The execution engine accepts either a decision-engine
 * {@link ExecutionPlan} (source `plan`) or a list of approved agent actions
 * (source `actions`); both are normalized into {@link ExecutionStep}s by the
 * planner.
 */

import type { ExecutionPlan } from '@seogod/decision-engine';
import type { ExecutionMode, ExecutionSource } from './shared.js';

export interface ApprovedActionInput {
  actionType: string;
  resourceType: string;
  resourceId: string;
  resourceRef?: string;
  payload: Record<string, unknown>;
  priority?: number;
  estimatedSeconds?: number;
  rationale?: string;
  dependsOn?: string[];
  approval?: {
    approved: boolean;
    decidedBy?: string;
    decidedAt?: Date;
    requestId?: string;
  };
}

export interface PlannedTask {
  id: string;
  planId?: string | null;
  decisionId?: string | null;
  recommendationId?: string | null;
  actionType: string;
  resourceType: string;
  resourceId: string;
  resourceRef?: string;
  payload: Record<string, unknown>;
  priority?: number;
  dependsOn?: string[];
  isMutating?: boolean;
  risk?: 'LOW' | 'MEDIUM' | 'HIGH';
  approved?: boolean;
  approvalRequestId?: string | null;
}

export interface ApprovalInput {
  /** Step/task ids that have been explicitly approved. */
  approvedIds?: string[];
  /** Step/task id -> approval request id. */
  requestIds?: Record<string, string>;
}

export interface ExecutionPlanInput {
  storeId: string;
  mode: ExecutionMode;
  /** A decision-engine plan (takes precedence over `actions`). */
  plan?: ExecutionPlan;
  /** Approved agent actions. */
  actions?: ApprovedActionInput[];
  planId?: string | null;
  workflowId?: string | null;
  decisionId?: string | null;
  approval?: ApprovalInput;
}

export interface ExecutionOptions {
  /** How steps are submitted: inline (default) or through the queue. */
  submit?: 'inline' | 'queue';
  /** Shopify store domain used for writes. Defaults to the storeId. */
  shopDomain?: string;
  /** Overrides for feature flags (future-ready). */
  features?: Record<string, boolean>;
}

export type ExecutionSourcePlan = Extract<ExecutionSource, 'plan' | 'actions'>;

/**
 * Validation types. Before any write, every step passes through a pipeline of
 * named checks (schema, approval, dependencies, state, conflicts, idempotency,
 * rollback availability, rate limits, permissions, policies). A step that
 * fails any check is rejected and never executed.
 */

import type { Execution, ExecutionStep } from './execution.js';
import type { SafetyConfig } from './safety.js';
import type { ExecutionMode } from './shared.js';

export interface ValidationFailure {
  /** The check that produced the failure, e.g. `schema`. */
  check: string;
  /** Machine-readable code for the failure. */
  code: string;
  message: string;
  stepId?: string;
  context?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  failures: ValidationFailure[];
}

export interface ApprovalState {
  approved: boolean;
  decidedBy?: string;
  decidedAt?: Date;
  requestId?: string;
}

export interface DependencyState {
  satisfied: string[];
  missing: string[];
  detail?: Record<string, unknown>;
}

export interface ValidationContext {
  execution: Execution;
  step: ExecutionStep;
  config: SafetyConfig;
  mode: ExecutionMode;
  /** Current Shopify state for the step's resource, when known. */
  resourceState?: Record<string, unknown> | null;
  /** Knowledge-graph supplied dependency state. */
  dependencies?: DependencyState;
  /** Decision/action approval state for this step. */
  approval?: ApprovalState;
  /** Idempotency keys already applied by this store. */
  existingKeys?: string[];
  /** Execution id currently holding the store lock, if any. */
  storeLockedBy?: string | null;
  /** True when the execution pipeline allows writes for this mode. */
  canWrite: boolean;
  /** Whether the publisher currently has budget for another write. */
  hasRateBudget: boolean;
  /** Writer capabilities available in this deployment. */
  writerCapabilities?: string[];
  /** Capability the step's operation requires, when known. */
  operationCapability?: string | null;
}

export interface ValidationCheck {
  readonly id: string;
  check(ctx: ValidationContext): ValidationResult | Promise<ValidationResult>;
}

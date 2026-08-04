/**
 * Safety configuration and guard primitives. Every execution is constrained by
 * a {@link SafetyConfig} that caps batch size, write rate, concurrency and
 * execution time, and is subject to kill switches and store locks.
 */

import type { ExecutionMode } from './shared.js';

/** Action types the engine refuses to execute no matter the approval state. */
export const REJECTED_ACTION_TYPES = ['delete_page'] as const;

export interface KillSwitchState {
  /** Global kill switch: when true no execution may write anywhere. */
  global: boolean;
  /** Per-store kill switch: storeId -> stopped. */
  stores: Record<string, boolean>;
}

export interface StoreLockState {
  /** storeId -> executionId that currently holds the write lock. */
  locks: Record<string, string>;
}

export interface RateWindow {
  /** Number of API calls observed in the current window. */
  count: number;
  /** Epoch ms when the current window started. */
  windowStartedAt: number;
}

export interface SafetyConfig {
  /** Maximum steps allowed in a single execution. */
  maxBatchSize: number;
  /** Maximum Shopify API writes per minute per store. */
  maxWriteRatePerMinute: number;
  /** When true, every mutating step requires an explicit approval record. */
  requireApproval: boolean;
  /** Action types that require approval even when `requireApproval` is false. */
  approvalRequiredActions: string[];
  /** Hard timeout for a single step, in ms. */
  executionTimeoutMs: number;
  /** Maximum concurrent steps a worker pool may run. */
  maxConcurrency: number;
  /** Modes this deployment may run at all. */
  allowedModes: ExecutionMode[];
  /** Reject the execution when the store is already locked. */
  enforceStoreLock: boolean;
  /** Enable the emergency stop (blocking execution) facility. */
  emergencyStopEnabled: boolean;
  /** Allow automatic rollback when a step fails mid-execution. */
  autoRollbackOnFailure: boolean;
  /** Reject writes against resources whose current state was not checked. */
  requireStateCheck: boolean;
  /** Maximum retry attempts per step before it goes to the dead-letter queue. */
  maxRetries: number;
  /** Base exponential backoff for retries, in ms. */
  backoffMs: number;
  /** Action types that may never be executed, regardless of approval. */
  rejectedActionTypes: string[];
  /** Default feature flags for execution (future-ready). */
  featureFlags: Record<string, boolean>;
}

export interface SafetyCheckResult {
  id: string;
  passed: boolean;
  message: string;
}

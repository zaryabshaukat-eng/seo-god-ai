/**
 * Shared primitives for the execution engine: execution modes, statuses and
 * rollback actions. Kept in a single module so every other type module can
 * reference them without forming circular imports.
 */

export type ExecutionMode = 'DRY_RUN' | 'SIMULATION' | 'STAGING' | 'PRODUCTION';

export type ExecutionSource = 'plan' | 'actions';

export type ExecutionStatus =
  | 'PENDING'
  | 'REJECTED'
  | 'VALIDATING'
  | 'QUEUED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ROLLED_BACK';

export type StepStatus =
  | 'PENDING'
  | 'READY'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'SIMULATED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'ROLLED_BACK';

export type BatchStatus =
  | 'PENDING'
  | 'READY'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'SIMULATED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'ROLLED_BACK';

export type RollbackStatus = 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export type RollbackStepAction = 'restore_field' | 'restore' | 'revert';

export type RollbackScope = 'single' | 'batch' | 'partial' | 'execution';

export type ExecutionSubmitStrategy = 'inline' | 'queue';

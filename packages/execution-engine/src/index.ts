/**
 * @seogod/execution-engine
 *
 * The only package allowed to write to Shopify. Executes approved decision
 * plans or agent actions through a validated, safety-gated pipeline that
 * publishes writes, computes diffs, tracks metrics and rolls back on failure.
 */

// Types
export type {
  ExecutionMode,
  ExecutionSource,
  ExecutionStatus,
  StepStatus,
  BatchStatus,
  RollbackStatus,
  RollbackStepAction,
  RollbackScope,
  ExecutionSubmitStrategy,
} from './types/shared.js';
export type {
  ApprovedActionInput,
  PlannedTask,
  ApprovalInput,
  ExecutionPlanInput,
  ExecutionOptions,
} from './types/plan.js';
export type {
  ExecutionHistoryEntry,
  ExecutionStep,
  ExecutionBatch,
  ExecutionSummary,
  Execution,
} from './types/execution.js';
export type { DiffKind, FieldDiff, ExecutionDiff } from './types/diff.js';
export type { RollbackStep, RollbackPlan, RollbackRecord } from './types/rollback.js';
export type { ExecutionMetrics } from './types/metrics.js';
export type {
  KillSwitchState,
  StoreLockState,
  RateWindow,
  SafetyConfig,
  SafetyCheckResult,
} from './types/safety.js';
export type { ExecutionEvent, ExecutionEventType, ExecutionSink } from './types/events.js';
export type {
  QueueEntry,
  QueueEntryStatus,
  RetryPolicy,
  EnqueueOptions,
  QueueStore,
} from './types/queue.js';
export type { ValidationFailure, ValidationResult, ValidationCheck, ValidationContext } from './types/validation.js';
export type { ExecutionReport } from './types/report.js';
export type {
  WriteCapability,
  ShopifyWriter,
  OperationResult,
  ExecutionOperation,
  Publisher,
  OperationRegistry,
} from './types/publisher.js';
export type { ExecutionFilter, ExecutionRepository } from './types/repository.js';
export { REJECTED_ACTION_TYPES } from './types/safety.js';

// Utils
export { ExecutionError, InvalidExecutionError, UnsupportedExecutionError, SafetyViolationError, StoreLockedError, ExecutionCancelledError, ExecutionTimeoutError, RollbackError, ConcurrencyError, ApprovalRequiredError, ExecutionRateLimitError, isExecutionError } from './utils/errors.js';
export { newId, deterministicUuid, isUuid } from './utils/ids.js';

// Diff
export { computeDiff, applyDiff, hasChanges, changedFields, buildExecutionDiff } from './diff/diff-engine.js';
export { renderDiff, oneLineSummary } from './diff/render.js';

// Models
export { idempotencyKeyFor, buildStep, buildBatch, buildExecution, refreshSummary } from './models/execution.js';
export { buildRollbackRecord } from './models/rollback.js';
export { buildMetrics } from './models/metrics.js';

// Safety
export { DEFAULT_SAFETY_CONFIG, normalizeSafetyConfig, assertValidConfig, isModeAllowed } from './safety/config.js';
export { KillSwitch } from './safety/kill-switch.js';
export { StoreLock } from './safety/store-lock.js';
export { RateLimiter } from './safety/rate-limiter.js';
export { detectConflicts } from './safety/conflict-detector.js';
export { withTimeout } from './safety/timeout.js';
export { SafetyGuard } from './safety/safety-guard.js';

// Queue
export { buildRetryPolicy } from './queue/retry-policy.js';
export { InMemoryQueueStore } from './queue/queue-store.js';
export { WorkerLoop } from './queue/worker-loop.js';
export { WorkerPool } from './queue/worker-pool.js';

// Publisher
export { ShopifyServiceWriter } from './publisher/shopify-writer.js';
export { OperationRegistryImpl } from './publisher/operation-registry.js';
export { OperationPublisher } from './publisher/publisher.js';
export {
  defaultOperations,
  buildOperation,
  seoFieldOperation,
  buildFieldOperation,
  buildGenericUpdateOperation,
} from './publisher/operations.js';

// Validators
export { SchemaValidator } from './validators/schema-validator.js';
export { ApprovalValidator } from './validators/approval-validator.js';
export { DependencyValidator } from './validators/dependency-validator.js';
export { StateValidator } from './validators/state-validator.js';
export { ConflictValidator } from './validators/conflict-validator.js';
export { IdempotencyValidator } from './validators/idempotency-validator.js';
export { RollbackValidator } from './validators/rollback-validator.js';
export { RateLimitValidator } from './validators/rate-limit-validator.js';
export { PermissionValidator } from './validators/permission-validator.js';
export { PolicyValidator } from './validators/policy-validator.js';
export { ValidationPipeline, defaultChecks } from './validators/validation-pipeline.js';

// Rollback
export { RollbackPlanner } from './rollback/planner.js';
export { RollbackEngine } from './rollback/engine.js';
export { validateRollbackCapability } from './rollback/validator.js';

// Planner
export { groupStepsIntoBatches } from './planner/grouping.js';
export { ExecutionPlanner } from './planner/execution-planner.js';

// Transactions
export { BatchSaga } from './transactions/saga.js';

// Approval
export { ApprovalGate } from './approval/gate.js';

// Dry run
export { DryRunPlanner } from './dry-run/planner.js';

// Executor
export { StepRunner, buildValidationContext } from './executor/step-runner.js';
export { ExecutionEngine } from './executor/execution-engine.js';

// Scheduler / workers
export { PriorityScheduler } from './scheduler/priority-scheduler.js';
export { ExecutionWorker } from './workers/execution-worker.js';

// Repositories
export { InMemoryExecutionRepository } from './repositories/in-memory-repository.js';

// Monitoring
export { EventBusSink, InMemorySink } from './monitoring/event-publisher.js';
export { ExecutionMonitor } from './monitoring/execution-monitor.js';

// Services
export { ExecutionService } from './services/execution-service.js';

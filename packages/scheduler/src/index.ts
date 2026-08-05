/**
 * @seogod/scheduler
 *
 * Autonomous scheduler for SEO GOD AI: cron-driven recurring crawls,
 * analysis and execution jobs with priority queues, retries with exponential
 * backoff, persistent job storage, distributed locking, outbox event
 * publishing and monitoring integration.
 */

export { parseCron, isCronValid, CronExpression } from './cron.js';

export {
  CronValidationError,
  JobTimeoutError,
  LockAcquireError,
  JobRunningError,
  MissingHandlerError,
  SchedulerError,
  SchedulerNotFoundError,
  SchedulerValidationError,
  SchedulerConflictError,
} from './errors.js';
export type { SchedulerErrorCode, SchedulerErrorContext } from './errors.js';

export { EventBusPublisher, SCHEDULER_EVENT_TYPES } from './events.js';
export type { SchedulerEventInput, SchedulerEventPublisher, SchedulerEventType } from './events.js';

export {
  crawlJobHandler,
  analysisJobHandler,
  executionJobHandler,
  JobHandlerRegistry,
} from './handlers.js';
export type { JobHandler, JobExecutionInput } from './handlers.js';

export { MemoryDistributedLock } from './lock.js';
export type { DistributedLock, LockAcquireResult } from './lock.js';

export { SchedulerMetrics, SCHEDULER_METRICS_NAMES } from './metrics.js';

export { PriorityQueue, jobPriorityComparator, priorityComparator } from './priority-queue.js';
export type { PriorityQueueComparator } from './priority-queue.js';

export { MemoryJobRepository } from './repository.js';
export type { JobRepository } from './repository.js';

export { AutonomousScheduler } from './service.js';
export type {
  AutonomousSchedulerDependencies,
  AutonomousSchedulerOptions,
} from './service.js';

export type {
  AttemptOutcome,
  JobFilter,
  JobKind,
  JobPriority,
  JobRun,
  JobRunResult,
  JobRunStatus,
  JobStatus,
  ScheduledJob,
  ScheduleJobInput,
  SchedulerRunSummary,
  UpdateJobInput,
} from './types.js';
export { JOB_KINDS, JOB_PRIORITIES } from './types.js';

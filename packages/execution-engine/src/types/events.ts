/**
 * Execution event types. Events are structured, typed and carry the logging
 * contract fields (executionId, batchId, workflowId, storeId, entityType,
 * entityId, operation, duration, retryCount, rollbackId, status).
 */

export type ExecutionEventType =
  | 'execution.queued'
  | 'execution.started'
  | 'execution.completed'
  | 'execution.failed'
  | 'execution.cancelled'
  | 'execution.rollback_started'
  | 'execution.rollback_completed'
  | 'execution.rollback_failed'
  | 'execution.publisher_failed'
  | 'execution.safety_violation';

export interface ExecutionEventBase {
  executionId: string;
  storeId: string;
  batchId?: string;
  workflowId?: string;
  entityType?: string;
  entityId?: string;
  operation?: string;
  duration?: number;
  retryCount?: number;
  rollbackId?: string;
  status?: string;
}

export type ExecutionEvent =
  | (ExecutionEventBase & { type: 'execution.queued' })
  | (ExecutionEventBase & { type: 'execution.started' })
  | (ExecutionEventBase & { type: 'execution.completed' })
  | (ExecutionEventBase & {
      type: 'execution.failed';
      error: string;
    })
  | (ExecutionEventBase & { type: 'execution.cancelled'; reason: string })
  | (ExecutionEventBase & { type: 'execution.rollback_started' })
  | (ExecutionEventBase & { type: 'execution.rollback_completed' })
  | (ExecutionEventBase & {
      type: 'execution.rollback_failed';
      error: string;
    })
  | (ExecutionEventBase & {
      type: 'execution.publisher_failed';
      error: string;
    })
  | (ExecutionEventBase & {
      type: 'execution.safety_violation';
      violation: string;
    });

/** Sink used by the engine and service; the event bus adapter is in monitoring. */
export interface ExecutionSink {
  emit(event: ExecutionEvent): Promise<void>;
}

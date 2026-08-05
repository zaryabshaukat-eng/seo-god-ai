/**
 * Outbox event publishing for the scheduler.
 *
 * Events flow through the platform outbox {@link EventBus} so downstream
 * consumers (audit trail, observability, dashboards) can react to job life
 * cycles without coupling. Publishing is best-effort: a publisher is
 * optional and failures are logged, never raised.
 */

import type { Prisma } from '@prisma/client';
import type { EventBus } from '@seogod/events';
import type { JobKind, JobPriority, JobRunStatus } from './types.js';

export const SCHEDULER_EVENT_TYPES = [
  'scheduler.job.scheduled',
  'scheduler.job.updated',
  'scheduler.job.cancelled',
  'scheduler.job.started',
  'scheduler.job.succeeded',
  'scheduler.job.failed',
  'scheduler.job.retrying',
  'scheduler.job.skipped',
] as const;

export type SchedulerEventType = (typeof SCHEDULER_EVENT_TYPES)[number];

export interface SchedulerEventInput {
  type: SchedulerEventType;
  jobId: string;
  kind: JobKind;
  name: string;
  priority: JobPriority;
  storeId: string | null;
  attempt?: number;
  error?: string;
  reason?: string;
  runId?: string;
  payload?: Record<string, unknown>;
}

/** Publish abstraction the rest of the package depends on. */
export interface SchedulerEventPublisher {
  publish(input: SchedulerEventInput): Promise<void>;
}

/**
 * Adapts the outbox {@link EventBus} to the scheduler's event shape. The bus
 * is typed structurally (`Pick<EventBus, 'publish'>`) so tests can hand in a
 * fake and the runtime dependency stays one method wide.
 */
export class EventBusPublisher implements SchedulerEventPublisher {
  constructor(private readonly bus: Pick<EventBus, 'publish'>) {}

  async publish(input: SchedulerEventInput): Promise<void> {
    const payload: Record<string, unknown> = {
      kind: input.kind,
      name: input.name,
      priority: input.priority,
      storeId: input.storeId,
      ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    };
    await this.bus.publish({
      type: input.type,
      aggregateType: 'schedulerJob',
      aggregateId: input.jobId,
      payload: payload as unknown as Prisma.InputJsonValue,
    });
  }
}

export type { JobRunStatus };

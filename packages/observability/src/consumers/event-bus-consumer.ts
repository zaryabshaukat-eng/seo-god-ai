/**
 * Subscribes the observability engine to the outbox {@link EventBus}. Event
 * payloads are routed back into typed observability events; unknown types are
 * ignored. The returned handler promise is surfaced to the bus so failures
 * are retried (at-least-once delivery).
 */

import type { OutboxEvent, Prisma } from '@prisma/client';
import type { CrawlStatistics } from '@seogod/crawler';
import type { EventBus } from '@seogod/events';
import type { ObservabilityService } from '../service/observability-service.js';
import { EXECUTION_EVENT_TYPES, type ObservabilityEvent } from '../types/events.js';

export interface EventBusConsumerOptions {
  /** Event types to subscribe to (defaults to the full supported set). */
  types?: string[];
}

export const DEFAULT_CONSUMED_TYPES = [
  ...EXECUTION_EVENT_TYPES,
  'crawl.completed',
  'crawl.failed',
  'seo.analysis.completed',
  'validation.failed',
] as const;

function payloadToRecord(payload: Prisma.JsonValue): Record<string, unknown> {
  if (payload === null || payload === undefined) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Rehydrates a typed observability event from an outbox payload. */
function route(type: string, payload: Record<string, unknown>): ObservabilityEvent | null {
  switch (type) {
    case 'crawl.completed': {
      const storeId = stringOr(payload.storeId);
      if (storeId === '') return null;
      return { type, storeId, statistics: payload.statistics as CrawlStatistics };
    }
    case 'crawl.failed': {
      const storeId = stringOr(payload.storeId);
      if (storeId === '') return null;
      return { type, storeId, error: stringOr(payload.error, 'unknown error') };
    }
    case 'seo.analysis.completed': {
      const storeId = stringOr(payload.storeId);
      if (storeId === '') return null;
      const overallScore = typeof payload.overallScore === 'number' ? payload.overallScore : 0;
      return {
        type,
        storeId,
        crawlJobId: stringOr(payload.crawlJobId) || undefined,
        executionId: stringOr(payload.executionId) || undefined,
        analyzedAt: stringOr(payload.analyzedAt) || undefined,
        overallScore,
        scores: typeof payload.scores === 'object' && payload.scores !== null && !Array.isArray(payload.scores) ? (payload.scores as Record<string, number>) : undefined,
        issues:
          Array.isArray(payload.issues)
            ? (payload.issues as Array<{ category: string; count: number }>)
            : undefined,
        recommendationsCount: typeof payload.recommendationsCount === 'number' ? payload.recommendationsCount : undefined,
        reference: payload.reference === 'BEFORE' || payload.reference === 'AFTER' ? payload.reference : undefined,
      };
    }
    case 'validation.failed': {
      const codes = Array.isArray(payload.codes)
        ? payload.codes.filter((code): code is string => typeof code === 'string')
        : [];
      return {
        type,
        executionId: stringOr(payload.executionId) || undefined,
        stepId: stringOr(payload.stepId) || undefined,
        taskId: stringOr(payload.taskId) || undefined,
        storeId: stringOr(payload.storeId) || undefined,
        codes,
        message: stringOr(payload.message) || undefined,
      };
    }
    default:
      if ((EXECUTION_EVENT_TYPES as readonly string[]).includes(type)) {
        return payload as unknown as ObservabilityEvent;
      }
      return null;
  }
}

export class EventBusConsumer {
  constructor(
    private readonly bus: Pick<EventBus, 'subscribe'>,
    private readonly service: ObservabilityService,
    private readonly options: EventBusConsumerOptions = {},
  ) {}

  /** Subscribes the consumer to the configured event types. */
  attach(): void {
    const types = this.options.types ?? [...DEFAULT_CONSUMED_TYPES];
    for (const type of types) {
      const handler = (event: OutboxEvent): Promise<void> => this.dispatch(type, event);
      this.bus.subscribe(type, handler);
    }
  }

  private async dispatch(type: string, event: OutboxEvent): Promise<void> {
    const routed = route(type, payloadToRecord(event.payload));
    if (routed === null) return;
    await this.service.handle(routed);
  }
}

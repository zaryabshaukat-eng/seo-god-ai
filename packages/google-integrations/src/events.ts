/**
 * Outbox event publishing for Google integrations.
 *
 * The package publishes events through the platform outbox `EventBus` so
 * downstream consumers (audit trail, observability) can react to syncs
 * without coupling. Publishing is best-effort: a publisher is optional and
 * failures are logged, never raised.
 */

import type { Prisma } from '@prisma/client';
import type { EventBus } from '@seogod/events';
import type { GoogleProvider } from './types.js';

export const GOOGLE_EVENT_TYPES = [
  'google.searchconsole.synced',
  'google.analytics.synced',
  'google.pagespeed.completed',
  'google.richresults.completed',
  'google.indexing.notified',
  'google.sync.failed',
] as const;

export type GoogleEventType = (typeof GOOGLE_EVENT_TYPES)[number];

export interface GoogleEventInput {
  type: GoogleEventType;
  provider: GoogleProvider;
  /** Resource that was synced (site URL, property id, page URL, ...). */
  resource: string;
  /** Optional correlation id (e.g. the sync run id). */
  aggregateId?: string;
  payload?: Record<string, unknown>;
}

/** Publish abstraction the rest of the package depends on. */
export interface GoogleEventPublisher {
  publish(input: GoogleEventInput): Promise<void>;
}

/**
 * Adapts the outbox {@link EventBus} to the package's event shape. The bus
 * is typed structurally (`Pick<EventBus, 'publish'>`) so tests can hand in
 * a fake and the runtime dependency stays one method wide.
 */
export class EventBusPublisher implements GoogleEventPublisher {
  constructor(private readonly bus: Pick<EventBus, 'publish'>) {}

  async publish(input: GoogleEventInput): Promise<void> {
    await this.bus.publish({
      type: input.type,
      aggregateType: 'google',
      aggregateId: input.aggregateId ?? `${input.provider}:${input.resource}`,
      payload: input.payload as unknown as Prisma.InputJsonValue,
    });
  }
}

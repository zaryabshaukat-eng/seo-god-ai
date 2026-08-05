/**
 * Observability store contract. Implementations must treat change history and
 * the event log as immutable: entries are append-only and never updated.
 */

import type {
  AlertRecord,
  ChangeRecord,
  ExecutionRecord,
  ExecutionStatus,
  SeoSnapshot,
} from '../types/models.js';
import type { ObservabilityEvent, StoredEvent } from '../types/events.js';

export interface ObservabilityFilter {
  storeId?: string;
  executionId?: string;
  status?: ExecutionStatus;
  /** Only entries at or after this ISO timestamp. */
  since?: string;
  /** Cap on returned rows (newest first). */
  limit?: number;
}

export interface ObservabilityStore {
  // Executions.
  upsertExecution(record: ExecutionRecord): Promise<void>;
  findExecution(executionId: string): Promise<ExecutionRecord | null>;
  listExecutions(filter?: ObservabilityFilter): Promise<ExecutionRecord[]>;

  // Immutable change history.
  appendChange(record: ChangeRecord): Promise<void>;
  listChanges(filter?: ObservabilityFilter): Promise<ChangeRecord[]>;

  // SEO snapshots.
  appendSnapshot(snapshot: SeoSnapshot): Promise<void>;
  listSnapshots(filter?: ObservabilityFilter): Promise<SeoSnapshot[]>;

  // Alerts.
  appendAlert(alert: AlertRecord): Promise<void>;
  listAlerts(filter?: ObservabilityFilter): Promise<AlertRecord[]>;

  // Immutable event log.
  appendEvent(event: StoredEvent): Promise<void>;
  listEvents(filter?: ObservabilityFilter): Promise<StoredEvent[]>;

  /** Removes all data (used by tests and resets). */
  reset(): Promise<void>;
}

export { type ObservabilityEvent, type StoredEvent };

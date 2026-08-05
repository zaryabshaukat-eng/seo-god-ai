/**
 * In-memory {@link ObservabilityStore}. Suitable for tests, dry-runs and
 * single-node deployments; not durable across restarts. Change history and
 * the event log are append-only — every read returns a fresh copy so callers
 * cannot mutate stored data through returned references.
 */

import type { AlertRecord, ChangeRecord, ExecutionRecord, SeoSnapshot } from '../types/models.js';
import type { StoredEvent } from '../types/events.js';
import type { ObservabilityFilter, ObservabilityStore } from './observability-store.js';

function limit<T>(rows: T[], max?: number): T[] {
  return max === undefined ? rows : rows.slice(0, max);
}

export class InMemoryObservabilityStore implements ObservabilityStore {
  private readonly executions = new Map<string, ExecutionRecord>();
  private readonly changes: ChangeRecord[] = [];
  private readonly snapshots: SeoSnapshot[] = [];
  private readonly alerts: AlertRecord[] = [];
  private readonly events: StoredEvent[] = [];

  async upsertExecution(record: ExecutionRecord): Promise<void> {
    const existing = this.executions.get(record.executionId);
    this.executions.set(record.executionId, existing === undefined ? record : { ...existing, ...record });
  }

  async findExecution(executionId: string): Promise<ExecutionRecord | null> {
    return this.executions.get(executionId) ?? null;
  }

  async listExecutions(filter: ObservabilityFilter = {}): Promise<ExecutionRecord[]> {
    const rows = [...this.executions.values()]
      .filter((record) => filter.storeId === undefined || record.storeId === filter.storeId)
      .filter((record) => filter.executionId === undefined || record.executionId === filter.executionId)
      .filter((record) => filter.status === undefined || record.status === filter.status)
      .filter((record) => filter.since === undefined || record.startedAt >= filter.since)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return limit(rows, filter.limit);
  }

  async appendChange(record: ChangeRecord): Promise<void> {
    if (!this.changes.some((entry) => entry.changeId === record.changeId)) {
      this.changes.push(record);
    }
  }

  async listChanges(filter: ObservabilityFilter = {}): Promise<ChangeRecord[]> {
    const rows = [...this.changes]
      .filter((record) => filter.storeId === undefined || record.storeId === filter.storeId)
      .filter((record) => filter.executionId === undefined || record.executionId === filter.executionId)
      .filter((record) => filter.since === undefined || record.appliedAt >= filter.since)
      .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
    return limit(rows, filter.limit);
  }

  async appendSnapshot(snapshot: SeoSnapshot): Promise<void> {
    if (!this.snapshots.some((entry) => entry.snapshotId === snapshot.snapshotId)) {
      this.snapshots.push(snapshot);
    }
  }

  async listSnapshots(filter: ObservabilityFilter = {}): Promise<SeoSnapshot[]> {
    const rows = [...this.snapshots]
      .filter((snapshot) => filter.storeId === undefined || snapshot.storeId === filter.storeId)
      .filter((snapshot) => filter.since === undefined || snapshot.capturedAt >= filter.since)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    return limit(rows, filter.limit);
  }

  async appendAlert(alert: AlertRecord): Promise<void> {
    if (!this.alerts.some((entry) => entry.alertId === alert.alertId)) {
      this.alerts.push(alert);
    }
  }

  async listAlerts(filter: ObservabilityFilter = {}): Promise<AlertRecord[]> {
    const rows = [...this.alerts]
      .filter((alert) => filter.storeId === undefined || alert.storeId === filter.storeId)
      .filter((alert) => filter.since === undefined || alert.triggeredAt >= filter.since)
      .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
    return limit(rows, filter.limit);
  }

  async appendEvent(event: StoredEvent): Promise<void> {
    if (!this.events.some((entry) => entry.id === event.id)) {
      this.events.push(event);
    }
  }

  async listEvents(filter: ObservabilityFilter = {}): Promise<StoredEvent[]> {
    const rows = [...this.events]
      .filter((event) => filter.storeId === undefined || event.storeId === filter.storeId)
      .filter((event) => filter.since === undefined || event.occurredAt >= filter.since)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return limit(rows, filter.limit);
  }

  async reset(): Promise<void> {
    this.executions.clear();
    this.changes.length = 0;
    this.snapshots.length = 0;
    this.alerts.length = 0;
    this.events.length = 0;
  }
}

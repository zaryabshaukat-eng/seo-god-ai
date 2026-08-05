/**
 * Dashboard aggregation: a single overview of executions, alerts and SEO
 * health across (optionally one) store.
 */

import type { ObservabilityStore } from '../store/observability-store.js';
import type { ObservabilityOverview } from '../types/signals.js';
import { TERMINAL_STATUSES } from '../types/models.js';

export class DashboardService {
  constructor(private readonly store: ObservabilityStore) {}

  async getOverview(storeId?: string): Promise<ObservabilityOverview> {
    const filter = storeId === undefined ? {} : { storeId };
    const [executions, snapshots, alerts] = await Promise.all([
      this.store.listExecutions(filter),
      this.store.listSnapshots(filter),
      this.store.listAlerts(filter),
    ]);

    const storeIds = new Set<string>();
    for (const record of executions) storeIds.add(record.storeId);
    for (const snapshot of snapshots) storeIds.add(snapshot.storeId);

    let completed = 0;
    let failed = 0;
    let rolledBack = 0;
    let active = 0;
    let latestExecutionAt: string | null = null;

    for (const record of executions) {
      if (record.status === 'COMPLETED') completed += 1;
      else if (record.status === 'FAILED') failed += 1;
      else if (record.status === 'ROLLED_BACK') rolledBack += 1;
      if (!TERMINAL_STATUSES.has(record.status)) active += 1;
      if (latestExecutionAt === null && record.completedAt !== undefined) latestExecutionAt = record.completedAt;
    }

    const terminal = completed + failed + rolledBack;
    const latestSnapshot = snapshots[0];

    return {
      storeCount: storeIds.size,
      executionCount: executions.length,
      activeExecutionCount: active,
      completedCount: completed,
      failedCount: failed,
      rolledBackCount: rolledBack,
      alertCount: alerts.length,
      openAlertCount: alerts.length,
      latestSeoScore: latestSnapshot?.overallScore ?? null,
      latestExecutionAt,
      successRate: terminal === 0 ? 0 : completed / terminal,
    };
  }
}

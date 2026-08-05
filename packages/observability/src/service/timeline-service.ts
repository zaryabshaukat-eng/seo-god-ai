/**
 * Builds historical timelines from the observability store: execution
 * history, SEO score history and performance buckets for the dashboard API.
 */

import type { ObservabilityStore } from '../store/observability-store.js';
import type {
  ObservabilityHistory,
  PerformanceTimeline,
  SeoTimeline,
  TimelinePoint,
} from '../types/models.js';
import { TERMINAL_STATUSES } from '../types/models.js';

export interface TimelineOptions {
  storeId?: string;
  /** Cap on returned points, newest first. */
  limit?: number;
}

export interface PerformanceTimelineOptions extends TimelineOptions {
  /** Bucket width in ms (defaults to one hour). */
  bucketMs?: number;
}

export class TimelineService {
  constructor(private readonly store: ObservabilityStore) {}

  async getHistory(options: TimelineOptions = {}): Promise<ObservabilityHistory> {
    const filter = options.storeId === undefined ? {} : { storeId: options.storeId };
    const limit = options.limit;
    const [executions, snapshots, changes, alerts, events] = await Promise.all([
      this.store.listExecutions(limit === undefined ? filter : { ...filter, limit }),
      this.store.listSnapshots(limit === undefined ? filter : { ...filter, limit }),
      this.store.listChanges(limit === undefined ? filter : { ...filter, limit }),
      this.store.listAlerts(limit === undefined ? filter : { ...filter, limit }),
      this.store.listEvents(limit === undefined ? filter : { ...filter, limit }),
    ]);
    return {
      executions,
      snapshots,
      changes,
      alerts,
      events: events.map(({ id, type, storeId, occurredAt }) => ({ id, type, storeId, occurredAt })),
    };
  }

  async getSeoTimeline(options: TimelineOptions = {}): Promise<SeoTimeline> {
    const snapshots = await this.store.listSnapshots(
      options.storeId === undefined ? {} : { storeId: options.storeId },
    );
    const points = snapshots
      .slice(0, options.limit)
      .map((snapshot) => ({
        timestamp: snapshot.capturedAt,
        overallScore: snapshot.overallScore,
        reference: snapshot.reference,
        pagesCrawled: snapshot.pagesCrawled,
        totalIssues: snapshot.totalIssues,
      }));
    return { storeId: options.storeId, points };
  }

  async getExecutionTimeline(options: TimelineOptions = {}): Promise<TimelinePoint[]> {
    const executions = await this.store.listExecutions(
      options.storeId === undefined ? {} : { storeId: options.storeId },
    );
    return executions.slice(0, options.limit).map((record) => ({
      timestamp: record.completedAt ?? record.startedAt,
      type: 'execution',
      storeId: record.storeId,
      value: record.durationMs ?? 0,
      label: record.status,
      executionId: record.executionId,
    }));
  }

  async getPerformanceTimeline(options: PerformanceTimelineOptions = {}): Promise<PerformanceTimeline> {
    const bucketMs = options.bucketMs ?? 60 * 60 * 1000;
    const executions = await this.store.listExecutions(
      options.storeId === undefined ? {} : { storeId: options.storeId },
    );
    const buckets = new Map<number, { count: number; failures: number; durations: number[] }>();

    for (const record of executions) {
      if (!TERMINAL_STATUSES.has(record.status)) continue;
      const timestamp = Date.parse(record.completedAt ?? record.startedAt);
      const start = Math.floor(timestamp / bucketMs) * bucketMs;
      const bucket = buckets.get(start) ?? { count: 0, failures: 0, durations: [] };
      bucket.count += 1;
      if (record.status === 'FAILED' || record.status === 'ROLLED_BACK') bucket.failures += 1;
      if (record.durationMs !== undefined) bucket.durations.push(record.durationMs);
      buckets.set(start, bucket);
    }

    const points = [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([start, bucket]) => ({
        timestamp: new Date(start).toISOString(),
        averageDurationMs:
          bucket.durations.length === 0
            ? 0
            : bucket.durations.reduce((sum, value) => sum + value, 0) / bucket.durations.length,
        executions: bucket.count,
        failures: bucket.failures,
      }));

    if (options.limit !== undefined) points.length = Math.min(points.length, options.limit);
    return { points };
  }
}

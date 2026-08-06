/**
 * KPI definitions, period aggregation (current vs previous period with
 * deltas and status) and an in-memory tracker that records snapshots over
 * time for historical KPI tracking.
 */

import type {
  KpiDefinition,
  KpiSnapshot,
  KpiStatus,
  ReportSourceData,
} from './types.js';
import { inPeriod, percentChange, round, safeDivide, type ReportPeriod } from './utils.js';

export const DEFAULT_KPIS: readonly KpiDefinition[] = [
  { key: 'seo_score', label: 'SEO Score', unit: '/100', source: 'seo', higherIsBetter: true },
  { key: 'clicks', label: 'Clicks', source: 'search', higherIsBetter: true },
  { key: 'impressions', label: 'Impressions', source: 'search', higherIsBetter: true },
  { key: 'ctr', label: 'CTR', unit: '%', source: 'search', higherIsBetter: true },
  { key: 'position', label: 'Avg Position', source: 'search', higherIsBetter: false },
  { key: 'sessions', label: 'Sessions', source: 'traffic', higherIsBetter: true },
  { key: 'users', label: 'Users', source: 'traffic', higherIsBetter: true },
  { key: 'pageviews', label: 'Page Views', source: 'traffic', higherIsBetter: true },
  { key: 'success_rate', label: 'Execution Success Rate', unit: '%', source: 'execution', higherIsBetter: true },
  { key: 'rollback_rate', label: 'Rollback Rate', unit: '%', source: 'execution', higherIsBetter: false },
  { key: 'alerts', label: 'Alerts', source: 'execution', higherIsBetter: false },
  { key: 'learning_success_rate', label: 'Learned Success Rate', unit: '%', source: 'learning', higherIsBetter: true },
];

/** Returns KPI definitions filtered to `keys` (or all defaults). */
export function getKpiDefinitions(keys?: readonly string[]): KpiDefinition[] {
  if (keys === undefined || keys.length === 0) return DEFAULT_KPIS.map((definition) => ({ ...definition }));
  const byKey = new Map(DEFAULT_KPIS.map((definition) => [definition.key, definition]));
  return keys
    .map((key) => byKey.get(key))
    .filter((definition) => definition !== undefined)
    .map((definition) => ({ ...(definition as KpiDefinition) }));
}

function searchIn(data: ReportSourceData, period: ReportPeriod) {
  return data.search.filter((row) => inPeriod(row.date, period));
}

function trafficIn(data: ReportSourceData, period: ReportPeriod) {
  return data.traffic.filter((row) => inPeriod(row.date, period));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function latestSeoScore(data: ReportSourceData, period: ReportPeriod): number | null {
  const candidates = data.snapshots
    .filter((snapshot) => inPeriod(snapshot.capturedAt, period))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const latest = candidates[0];
  return latest === undefined ? null : latest.overallScore;
}

function executionTotals(data: ReportSourceData, period: ReportPeriod) {
  const rows = data.executions.filter((record) => inPeriod(record.startedAt, period));
  const completed = rows.filter((record) => record.status === 'COMPLETED').length;
  const rolledBack = rows.filter((record) => record.status === 'ROLLED_BACK').length;
  const terminal = rows.filter(
    (record) =>
      record.status === 'COMPLETED' ||
      record.status === 'FAILED' ||
      record.status === 'CANCELLED' ||
      record.status === 'ROLLED_BACK',
  ).length;
  return { rows, completed, rolledBack, terminal };
}

interface KpiValueFn {
  (data: ReportSourceData, period: ReportPeriod): number | null;
}

const KPI_VALUES: Record<string, KpiValueFn> = {
  seo_score: latestSeoScore,
  clicks: (data, period) => sum(searchIn(data, period).map((row) => row.clicks)),
  impressions: (data, period) => sum(searchIn(data, period).map((row) => row.impressions)),
  ctr: (data, period) => {
    const rows = searchIn(data, period);
    const clicks = sum(rows.map((row) => row.clicks));
    const impressions = sum(rows.map((row) => row.impressions));
    const rate = safeDivide(clicks, impressions);
    return rate === null ? null : round(rate * 100);
  },
  position: (data, period) => {
    const rows = searchIn(data, period);
    const impressions = sum(rows.map((row) => row.impressions));
    const weighted = sum(rows.map((row) => row.position * row.impressions));
    const average = safeDivide(weighted, impressions);
    return average === null ? null : round(average);
  },
  sessions: (data, period) => sum(trafficIn(data, period).map((row) => row.sessions)),
  users: (data, period) => sum(trafficIn(data, period).map((row) => row.users)),
  pageviews: (data, period) => sum(trafficIn(data, period).map((row) => row.pageviews)),
  success_rate: (data, period) => {
    const totals = executionTotals(data, period);
    const rate = safeDivide(totals.completed, totals.terminal);
    return rate === null ? null : round(rate * 100);
  },
  rollback_rate: (data, period) => {
    const totals = executionTotals(data, period);
    const rate = safeDivide(totals.rolledBack, totals.terminal);
    return rate === null ? null : round(rate * 100);
  },
  alerts: (data, period) => data.alerts.filter((alert) => inPeriod(alert.triggeredAt, period)).length,
  learning_success_rate: (data) =>
    data.analysis === null ? null : round(data.analysis.summary.overallSuccessRate * 100),
};

function kpiStatus(higherIsBetter: boolean, change: number | null): KpiStatus {
  if (change === null) return 'no-data';
  if (Math.abs(change) < 1e-9) return 'neutral';
  return (change > 0) === higherIsBetter ? 'improved' : 'declined';
}

/** True when the period contains source data relevant to a KPI key. */
function hasDataForKey(key: string, data: ReportSourceData, period: ReportPeriod): boolean {
  switch (key) {
    case 'seo_score':
      return data.snapshots.some((snapshot) => inPeriod(snapshot.capturedAt, period));
    case 'clicks':
    case 'impressions':
    case 'ctr':
    case 'position':
      return searchIn(data, period).length > 0;
    case 'sessions':
    case 'users':
    case 'pageviews':
      return trafficIn(data, period).length > 0;
    case 'success_rate':
    case 'rollback_rate':
      return data.executions.some((record) => inPeriod(record.startedAt, period));
    case 'alerts':
      return data.alerts.some((alert) => inPeriod(alert.triggeredAt, period));
    case 'learning_success_rate':
      return data.analysis !== null;
  }
  return true;
}

/** Aggregates KPI snapshots for a period, with optional previous-period deltas. */
export function aggregateKpis(
  data: ReportSourceData,
  period: ReportPeriod,
  previousPeriod?: ReportPeriod,
  keys?: readonly string[],
): KpiSnapshot[] {
  return getKpiDefinitions(keys).map((definition) => {
    const value = (KPI_VALUES[definition.key]?.(data, period) ?? null) as number | null;
    const previousValue =
      previousPeriod === undefined || !hasDataForKey(definition.key, data, previousPeriod)
        ? null
        : ((KPI_VALUES[definition.key]?.(data, previousPeriod) ?? null) as number | null);
    const change = value === null || previousValue === null ? null : round(value - previousValue);
    const changePercent = percentChange(value, previousValue);
    return {
      key: definition.key,
      label: definition.label,
      unit: definition.unit,
      value,
      previousValue,
      change,
      changePercent,
      higherIsBetter: definition.higherIsBetter,
      status: kpiStatus(definition.higherIsBetter, change),
    };
  });
}

export interface KpiRecord {
  storeId?: string;
  period: ReportPeriod;
  snapshots: KpiSnapshot[];
  recordedAt: string;
}

/** In-memory tracker for KPI snapshots across tracking runs. */
export class KpiTracker {
  private readonly records: KpiRecord[] = [];

  async record(
    storeId: string | undefined,
    period: ReportPeriod,
    snapshots: readonly KpiSnapshot[],
    now: () => string = () => new Date().toISOString(),
  ): Promise<KpiRecord> {
    const record: KpiRecord = {
      storeId,
      period,
      snapshots: snapshots.map((snapshot) => ({ ...snapshot })),
      recordedAt: now(),
    };
    this.records.push(record);
    return record;
  }

  async list(storeId?: string): Promise<KpiRecord[]> {
    return this.records
      .filter((record) => storeId === undefined || record.storeId === storeId)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }

  async latest(storeId?: string): Promise<KpiRecord | null> {
    const records = await this.list(storeId);
    return records[0] ?? null;
  }

  /** All recorded values for a KPI key, newest first. */
  async history(storeId: string | undefined, key: string): Promise<KpiSnapshot[]> {
    const records = await this.list(storeId);
    return records
      .flatMap((record) => record.snapshots.map((snapshot) => ({ ...snapshot, period: record.period })))
      .filter((snapshot) => snapshot.key === key)
      .sort((a, b) => b.period.endDate.localeCompare(a.period.endDate));
  }

  async reset(): Promise<void> {
    this.records.length = 0;
  }
}

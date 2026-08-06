/**
 * Aggregation layer: turns raw source rows (executions, snapshots, alerts,
 * changes, learning analysis) into report-ready summaries, trend series and
 * alert summaries. All functions are pure and operate on periods via the
 * `YYYY-MM-DD` inclusive `ReportPeriod` contract.
 */

import type {
  AlertRecordLike,
  AlertSummary,
  ChangeRecordLike,
  ExecutionRecordLike,
  ExecutionSummary,
  FeedbackSummaryLike,
  HistoricalOutcomeResultLike,
  OutcomeAnalysisLike,
  ReportSourceData,
  RulePerformanceRow,
  SeoSnapshotLike,
  SeoSummary,
  TrendPoint,
  TrendSeries,
} from './types.js';
import type { ReportPeriod } from './utils.js';
import {
  clamp,
  inPeriod,
  percentile,
  safeDivide,
  toIsoDate,
} from './utils.js';

function dateOf(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/** Latest and previous SEO scores from snapshots inside a period. */
export function buildSeoSummary(snapshots: readonly SeoSnapshotLike[], period: ReportPeriod): SeoSummary {
  const sorted = snapshots
    .filter((snapshot) => inPeriod(snapshot.capturedAt, period))
    .slice()
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const latest = sorted[sorted.length - 1];
  const previous = sorted.length >= 2 ? sorted[sorted.length - 2] : undefined;
  const latestScore = latest === undefined ? null : latest.overallScore;
  const previousScore = previous === undefined ? null : previous.overallScore;
  const delta =
    latestScore === null || previousScore === null ? null : Math.round((latestScore - previousScore) * 100) / 100;
  return {
    latestScore,
    previousScore,
    delta,
    totalIssues: latest?.totalIssues ?? null,
    pagesCrawled: latest?.pagesCrawled ?? null,
    brokenLinks: latest?.brokenLinks ?? null,
    snapshots: sorted.length,
  };
}

/** Execution rollup for a period (rates are fractions 0..1). */
export function buildExecutionSummary(
  executions: readonly ExecutionRecordLike[],
  changes: readonly ChangeRecordLike[],
  period: ReportPeriod,
): ExecutionSummary {
  const rows = executions.filter((record) => inPeriod(record.startedAt, period));
  const byStatus: Record<string, number> = {};
  for (const record of rows) {
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
  }
  const completed = byStatus['COMPLETED'] ?? 0;
  const failed = byStatus['FAILED'] ?? 0;
  const cancelled = byStatus['CANCELLED'] ?? 0;
  const rolledBack = byStatus['ROLLED_BACK'] ?? 0;
  const terminal = completed + failed + cancelled + rolledBack;

  const durations = rows
    .filter((record) => record.status === 'COMPLETED' && record.durationMs !== undefined)
    .map((record) => record.durationMs as number);

  const periodChanges = changes.filter((change) => inPeriod(change.appliedAt, period));
  const changesApplied = periodChanges.filter((change) => change.kind === 'apply').length;
  const changesReverted = periodChanges.filter((change) => change.kind === 'revert').length;

  return {
    totalExecutions: rows.length,
    completed,
    failed,
    cancelled,
    rolledBack,
    byStatus,
    successRate: completed === 0 ? null : safeDivide(completed, terminal),
    averageDurationMs:
      durations.length === 0 ? null : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    p95DurationMs: durations.length === 0 ? null : percentile(durations, 95),
    changesApplied,
    changesReverted,
  };
}

/** Per-rule rollup from execution records (rule = operation or `execution`). */
export function deriveRulePerformance(executions: readonly ExecutionRecordLike[]): RulePerformanceRow[] {
  const grouped = new Map<string, { attempts: number; successes: number; failures: number; rolledBack: number }>();
  for (const record of executions) {
    if (record.status === 'CANCELLED') continue;
    const rule = record.operation ?? 'execution';
    const entry = grouped.get(rule) ?? { attempts: 0, successes: 0, failures: 0, rolledBack: 0 };
    entry.attempts += 1;
    if (record.status === 'COMPLETED') entry.successes += 1;
    if (record.status === 'FAILED') entry.failures += 1;
    if (record.status === 'ROLLED_BACK') entry.rolledBack += 1;
    grouped.set(rule, entry);
  }
  return [...grouped.entries()]
    .map(([rule, entry]) => ({
      rule,
      attempts: entry.attempts,
      successes: entry.successes,
      failures: entry.failures,
      skipped: 0,
      rolledBack: entry.rolledBack,
      successRate: safeDivide(entry.successes, entry.attempts),
      averageImpact: null,
    }))
    .sort((a, b) => b.attempts - a.attempts || a.rule.localeCompare(b.rule));
}

/** Learning section summary from learning-engine analysis + feedback. */
export function buildLearningSummary(
  analysis: OutcomeAnalysisLike | null,
  feedback: FeedbackSummaryLike | null,
  historicalOutcomes: readonly HistoricalOutcomeResultLike[],
): {
  outcomes: number;
  rules: number;
  overallSuccessRate: number | null;
  overallAverageImpact: number | null;
  feedback: { total: number; positive: number; negative: number; neutral: number; netScore: number };
  topRules: RulePerformanceRow[];
  historicalOutcomes: HistoricalOutcomeRowLike[];
} {
  const rules = (analysis?.rules ?? [])
    .map((rule) => ({
      rule: rule.rule,
      attempts: rule.attempts,
      successes: rule.successes,
      failures: rule.failures,
      skipped: rule.skipped,
      rolledBack: rule.rolledBack,
      successRate: rule.successRate,
      averageImpact: rule.averageImpact,
    }))
    .sort((a, b) => b.attempts - a.attempts || a.rule.localeCompare(b.rule))
    .slice(0, 10);
  return {
    outcomes: analysis?.summary.totalOutcomes ?? 0,
    rules: analysis?.summary.rulesAnalyzed ?? 0,
    overallSuccessRate: analysis === null ? null : analysis.summary.overallSuccessRate,
    overallAverageImpact: analysis === null ? null : analysis.summary.overallAverageImpact,
    feedback: {
      total: feedback?.total ?? 0,
      positive: feedback?.positive ?? 0,
      negative: feedback?.negative ?? 0,
      neutral: feedback?.neutral ?? 0,
      netScore: feedback?.netScore ?? 0,
    },
    topRules: rules,
    historicalOutcomes: historicalOutcomes.map((outcome) => ({
      rule: outcome.rule,
      attempts: outcome.attempts,
      successes: outcome.successes,
      averageImpact: outcome.averageImpact,
    })),
  };
}

interface HistoricalOutcomeRowLike {
  rule: string;
  attempts: number;
  successes: number;
  averageImpact: number;
}

/** Alert rollup for a period. */
export function aggregateAlerts(alerts: readonly AlertRecordLike[], period: ReportPeriod): AlertSummary {
  const items = alerts
    .filter((alert) => inPeriod(alert.triggeredAt, period))
    .map((alert) => ({
      alertId: alert.alertId,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      triggeredAt: alert.triggeredAt,
      storeId: alert.storeId,
    }));
  let critical = 0;
  let warning = 0;
  let info = 0;
  const byType: Record<string, number> = {};
  for (const item of items) {
    if (item.severity === 'critical') critical += 1;
    if (item.severity === 'warning') warning += 1;
    if (item.severity === 'info') info += 1;
    byType[item.type] = (byType[item.type] ?? 0) + 1;
  }
  return { total: items.length, critical, warning, info, byType, items };
}

function dailySums(
  rows: Array<{ date: string; value: number }>,
  period: ReportPeriod,
): TrendPoint[] {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (!inPeriod(row.date, period)) continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.value);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

function lastPerDay(
  rows: Array<{ date: string; value: number }>,
  period: ReportPeriod,
): TrendPoint[] {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (!inPeriod(row.date, period)) continue;
    byDate.set(row.date, row.value);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

function weightedPerDay(
  rows: Array<{ date: string; numerator: number; weight: number }>,
  period: ReportPeriod,
): TrendPoint[] {
  const byDate = new Map<string, { numerator: number; weight: number }>();
  for (const row of rows) {
    if (!inPeriod(row.date, period)) continue;
    const entry = byDate.get(row.date) ?? { numerator: 0, weight: 0 };
    entry.numerator += row.numerator;
    entry.weight += row.weight;
    byDate.set(row.date, entry);
  }
  return [...byDate.keys()]
    .sort()
    .map((date) => {
      const entry = byDate.get(date);
      const value = entry === undefined || entry.weight === 0 ? 0 : entry.numerator / entry.weight;
      return { date, value: Math.round(value * 100) / 100 };
    });
}

/** Builds the ordered trend series present in the period's data. */
export function buildTrendSeries(data: ReportSourceData, period: ReportPeriod): TrendSeries[] {
  const series: TrendSeries[] = [];

  const seoPoints = lastPerDay(
    data.snapshots.map((snapshot) => ({ date: dateOf(snapshot.capturedAt), value: snapshot.overallScore })),
    period,
  );
  if (seoPoints.length > 0) {
    series.push({ key: 'seo_score', label: 'SEO Score', unit: '/100', period, points: seoPoints });
  }

  const clicks = dailySums(
    data.search.map((row) => ({ date: row.date, value: row.clicks })),
    period,
  );
  if (clicks.length > 0) series.push({ key: 'clicks', label: 'Clicks', period, points: clicks });

  const impressions = dailySums(
    data.search.map((row) => ({ date: row.date, value: row.impressions })),
    period,
  );
  if (impressions.length > 0) {
    series.push({ key: 'impressions', label: 'Impressions', period, points: impressions });
  }

  const ctrPoints = weightedPerDay(
    data.search.map((row) => ({ date: row.date, numerator: row.clicks, weight: row.impressions })),
    period,
  );
  if (ctrPoints.length > 0) {
    series.push({ key: 'ctr', label: 'CTR', unit: '%', period, points: ctrPoints });
  }

  const positionPoints = weightedPerDay(
    data.search.map((row) => ({
      date: row.date,
      numerator: row.position * row.impressions,
      weight: row.impressions,
    })),
    period,
  );
  if (positionPoints.length > 0) {
    series.push({ key: 'position', label: 'Avg Position', period, points: positionPoints });
  }

  const trafficSeries: Array<{ key: string; label: string; value: (row: ReportSourceData['traffic'][number]) => number }> = [
    { key: 'sessions', label: 'Sessions', value: (row) => row.sessions },
    { key: 'users', label: 'Users', value: (row) => row.users },
    { key: 'pageviews', label: 'Page Views', value: (row) => row.pageviews },
  ];
  for (const entry of trafficSeries) {
    const points = dailySums(data.traffic.map((row) => ({ date: row.date, value: entry.value(row) })), period);
    if (points.length > 0) series.push({ key: entry.key, label: entry.label, period, points });
  }

  const executions = dailySums(
    data.executions
      .filter((record) => record.status === 'COMPLETED' || record.status === 'FAILED')
      .map((record) => ({ date: dateOf(record.startedAt), value: 1 })),
    period,
  );
  if (executions.length > 0) {
    series.push({ key: 'executions', label: 'Executions', period, points: executions });
  }

  const alerts = dailySums(
    data.alerts.map((alert) => ({ date: dateOf(alert.triggeredAt), value: 1 })),
    period,
  );
  if (alerts.length > 0) {
    series.push({ key: 'alerts', label: 'Alerts', period, points: alerts });
  }

  return series;
}

/** Clamps a trend series to a maximum point count (keeps the tail). */
export function limitTrendPoints(points: readonly TrendPoint[], max: number): TrendPoint[] {
  if (points.length <= max) return points.slice();
  return points.slice(points.length - max);
}

/** Scales a trend series into 0..1 for charting (single-value series map to 0.5). */
export function normalizeSeries(points: readonly TrendPoint[]): Array<{ date: string; value: number }> {
  if (points.length === 0) return [];
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return points.map((point) => ({
    date: point.date,
    value: span === 0 ? 0.5 : clamp((point.value - min) / span, 0, 1),
  }));
}

export function seoSeriesDate(value: string): string {
  return toIsoDate(new Date(value));
}

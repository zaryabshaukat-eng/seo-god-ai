/**
 * Report templates: each `ReportKind` maps to a deterministic set of sections
 * derived from the aggregated source data. Templates are pure functions of
 * `ReportSourceData` (+ an optional previous period for KPI deltas) so the
 * same input always yields the same report — important for tests, caching
 * and scheduled output.
 */

import {
  aggregateAlerts,
  buildExecutionSummary,
  buildLearningSummary,
  buildSeoSummary,
  buildTrendSeries,
  deriveRulePerformance,
} from './aggregation.js';
import { ReportValidationError } from './errors.js';
import { aggregateKpis } from './kpis.js';
import type {
  AlertSummary,
  AlertSummaryItem,
  ReportKind,
  ReportSection,
  ReportSourceData,
  TrendSeries,
} from './types.js';
import { inPeriod, round, type ReportPeriod } from './utils.js';

export interface ReportTemplate {
  kind: ReportKind;
  title: string;
  description?: string;
  buildSections(
    data: ReportSourceData,
    options?: { previousPeriod?: ReportPeriod; trends?: TrendSeries[]; alerts?: AlertSummary },
  ): ReportSection[];
}

const SERIES_PRIORITY: Record<string, number> = {
  seo_score: 0,
  clicks: 1,
  impressions: 2,
  ctr: 3,
  position: 4,
  sessions: 5,
  users: 6,
  pageviews: 7,
  executions: 8,
  alerts: 9,
};

function sortSeries(series: TrendSeries[]): TrendSeries[] {
  return [...series].sort(
    (a, b) => (SERIES_PRIORITY[a.key] ?? 99) - (SERIES_PRIORITY[b.key] ?? 99) || a.label.localeCompare(b.label),
  );
}

function executionsIn(data: ReportSourceData) {
  return data.executions.filter((record) => inPeriod(record.startedAt, data.period));
}

function pct(value: number | null, digits = 1): string {
  return value === null ? 'n/a' : `${round(value * 100, digits)}%`;
}

function num(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : String(value);
}

function summarySection(data: ReportSourceData): ReportSection {
  const seo = buildSeoSummary(data.snapshots, data.period);
  const executions = buildExecutionSummary(data.executions, data.changes, data.period);
  const alerts = aggregateAlerts(data.alerts, data.period);
  const learningRate = data.analysis === null ? null : data.analysis.summary.overallSuccessRate;
  return {
    kind: 'summary',
    title: 'Summary',
    metrics: [
      { label: 'Period', value: `${data.period.startDate} \u2192 ${data.period.endDate}` },
      { label: 'SEO Score', value: num(seo.latestScore), delta: seo.delta },
      { label: 'Executions', value: executions.totalExecutions },
      { label: 'Success Rate', value: pct(executions.successRate) },
      { label: 'Alerts', value: `${alerts.total} (${alerts.critical} critical, ${alerts.warning} warning)` },
      { label: 'Learned Success Rate', value: pct(learningRate) },
    ],
    body: [
      `${executions.completed} of ${executions.totalExecutions} executions completed (${pct(executions.successRate)}), ${executions.rolledBack} rolled back.`,
      `${alerts.critical} critical and ${alerts.warning} warning alerts fired in the period.`,
      `Learning engine recorded ${data.analysis === null ? 0 : data.analysis.summary.totalOutcomes} outcomes across ${data.analysis === null ? 0 : data.analysis.summary.rulesAnalyzed} rules.`,
    ],
  };
}

function kpiSection(data: ReportSourceData, previousPeriod?: ReportPeriod, keys?: readonly string[]): ReportSection {
  const kpis = aggregateKpis(data, data.period, previousPeriod, keys);
  const improved = kpis.filter((kpi) => kpi.status === 'improved').length;
  const declined = kpis.filter((kpi) => kpi.status === 'declined').length;
  return {
    kind: 'kpis',
    title: 'KPIs',
    metrics: kpis.map((kpi) => ({
      label: kpi.label,
      value: kpi.value === null ? 'n/a' : kpi.value,
      delta: kpi.change,
    })),
    body: [`${improved} improved, ${declined} declined, ${kpis.length - improved - declined} stable or unknown.`],
  };
}

function seoSection(data: ReportSourceData): ReportSection {
  const seo = buildSeoSummary(data.snapshots, data.period);
  return {
    kind: 'seo',
    title: 'SEO Health',
    metrics: [
      { label: 'Latest Score', value: seo.latestScore ?? 'n/a', delta: seo.delta },
      { label: 'Total Issues', value: seo.totalIssues ?? 'n/a' },
      { label: 'Pages Crawled', value: seo.pagesCrawled ?? 'n/a' },
      { label: 'Broken Links', value: seo.brokenLinks ?? 'n/a' },
      { label: 'Snapshots', value: seo.snapshots },
    ],
  };
}

function trendsSections(
  trends: TrendSeries[],
  select: readonly string[] | 'all',
  options: { previousPeriod?: ReportPeriod; alerts?: AlertSummary },
): ReportSection[] {
  const ordered = sortSeries(trends);
  const chosen = select === 'all' ? ordered : ordered.filter((series) => select.includes(series.key));
  if (chosen.length === 0) {
    return [{ kind: 'trends', title: 'Trends', body: ['No trend data available for this period.'] }];
  }
  return chosen.map((series) => ({
    kind: 'trends',
    title: series.label,
    description: options.alerts === undefined ? undefined : `Daily values over ${series.period.startDate} \u2192 ${series.period.endDate}.`,
    unit: series.unit,
    points: series.points,
  }));
}

function alertsSection(data: ReportSourceData, alerts: AlertSummary): ReportSection {
  const byType = Object.entries(alerts.byType)
    .map(([type, count]) => `${type} (${count})`)
    .join(', ');
  return {
    kind: 'alerts',
    title: 'Alerts',
    metrics: [
      { label: 'Total', value: alerts.total },
      { label: 'Critical', value: alerts.critical },
      { label: 'Warning', value: alerts.warning },
      { label: 'Info', value: alerts.info },
    ],
    body: [
      `By type: ${byType === '' ? 'none' : byType}.`,
      ...alerts.items
        .slice(0, 10)
        .map((item: AlertSummaryItem) => `${item.severity.toUpperCase()}: ${item.message} (${item.triggeredAt})`),
    ],
  };
}

function executionSection(data: ReportSourceData): ReportSection {
  const summary = buildExecutionSummary(data.executions, data.changes, data.period);
  const rules = deriveRulePerformance(executionsIn(data));
  const hasPlans = data.plans.length > 0;
  return {
    kind: 'execution',
    title: 'Execution',
    metrics: [
      { label: 'Total', value: summary.totalExecutions },
      { label: 'Completed', value: summary.completed },
      { label: 'Failed', value: summary.failed },
      { label: 'Cancelled', value: summary.cancelled },
      { label: 'Rolled Back', value: summary.rolledBack },
      { label: 'Success Rate', value: pct(summary.successRate) },
      { label: 'Avg Duration (ms)', value: num(summary.averageDurationMs) },
      { label: 'P95 Duration (ms)', value: num(summary.p95DurationMs) },
      { label: 'Changes Applied', value: summary.changesApplied },
      { label: 'Changes Reverted', value: summary.changesReverted },
    ],
    ...(hasPlans
      ? {
          header: ['Plan', 'Status', 'Risk', 'Tasks', 'Impact', 'Created', 'Updated'],
          rows: data.plans.map((plan) => [
            plan.planId,
            plan.status,
            plan.risk,
            plan.taskCount,
            plan.totalImpact,
            plan.createdAt,
            plan.updatedAt,
          ]),
          body: ['Plans active in the period:'],
        }
      : {
          header: ['Rule', 'Attempts', 'Successes', 'Failures', 'Rolled Back', 'Success Rate %'],
          rows: rules.map((rule) => [
            rule.rule,
            rule.attempts,
            rule.successes,
            rule.failures,
            rule.rolledBack,
            round((rule.successRate ?? 0) * 100),
          ]),
        }),
  };
}

function learningSection(data: ReportSourceData): ReportSection {
  const summary = buildLearningSummary(data.analysis, data.feedback, data.historicalOutcomes);
  return {
    kind: 'learning',
    title: 'Learning',
    metrics: [
      { label: 'Outcomes', value: summary.outcomes },
      { label: 'Rules', value: summary.rules },
      { label: 'Success Rate', value: pct(summary.overallSuccessRate) },
      { label: 'Avg Impact', value: num(summary.overallAverageImpact) },
      { label: 'Feedback', value: `${summary.feedback.positive} positive / ${summary.feedback.negative} negative` },
      { label: 'Net Score', value: summary.feedback.netScore },
    ],
    header: ['Rule', 'Attempts', 'Successes', 'Success Rate %', 'Avg Impact'],
    rows: summary.topRules.map((rule) => [
      rule.rule,
      rule.attempts,
      rule.successes,
      round((rule.successRate ?? 0) * 100),
      num(rule.averageImpact),
    ]),
    body: summary.topRules.slice(0, 5).map(
      (rule) => `\u2713 ${rule.rule}: ${rule.successes}/${rule.attempts} successful`,
    ),
  };
}

function opportunitiesSection(data: ReportSourceData): ReportSection {
  const recommendations = data.recommendations.slice(0, 5);
  return {
    kind: 'opportunities',
    title: 'Top Opportunities',
    header: ['Recommendation', 'Rule', 'Priority', 'Score', 'Impact', 'Effort', 'Pages'],
    rows: recommendations.map((rec) => [
      rec.title,
      rec.rule,
      rec.priority,
      rec.score,
      rec.impact,
      rec.effort,
      rec.pageCount,
    ]),
    body:
      recommendations.length === 0
        ? ['No recommendations available from the decision engine.']
        : recommendations.map(
            (rec) => `\u25B8 ${rec.title} (${rec.rule}) — ${rec.impact} impact, ${rec.effort} effort`,
          ),
  };
}

function executiveDashboardSections(
  data: ReportSourceData,
  options: { previousPeriod?: ReportPeriod; trends?: TrendSeries[]; alerts?: AlertSummary } = {},
): ReportSection[] {
  return [
    summarySection(data),
    kpiSection(data, options.previousPeriod),
    alertsSection(data, options.alerts ?? aggregateAlerts(data.alerts, data.period)),
    executionSection(data),
    learningSection(data),
    ...trendsSections(options.trends ?? buildTrendSeries(data, data.period), ['seo_score', 'clicks', 'impressions', 'position'], options),
    opportunitiesSection(data),
  ];
}

function seoSections(
  data: ReportSourceData,
  options: { previousPeriod?: ReportPeriod; trends?: TrendSeries[]; alerts?: AlertSummary } = {},
): ReportSection[] {
  return [
    summarySection(data),
    seoSection(data),
    ...trendsSections(
      options.trends ?? buildTrendSeries(data, data.period),
      ['seo_score', 'clicks', 'impressions', 'ctr', 'position'],
      options,
    ),
  ];
}

function kpiSections(
  data: ReportSourceData,
  options: { previousPeriod?: ReportPeriod; trends?: TrendSeries[]; alerts?: AlertSummary } = {},
): ReportSection[] {
  return [summarySection(data), kpiSection(data, options.previousPeriod), learningSection(data)];
}

function trendsTemplateSections(
  data: ReportSourceData,
  options: { previousPeriod?: ReportPeriod; trends?: TrendSeries[]; alerts?: AlertSummary } = {},
): ReportSection[] {
  return [summarySection(data), ...trendsSections(options.trends ?? buildTrendSeries(data, data.period), 'all', options)];
}

function alertsTemplateSections(
  data: ReportSourceData,
  options: { previousPeriod?: ReportPeriod; trends?: TrendSeries[]; alerts?: AlertSummary } = {},
): ReportSection[] {
  return [
    summarySection(data),
    alertsSection(data, options.alerts ?? aggregateAlerts(data.alerts, data.period)),
    executionSection(data),
  ];
}

const TEMPLATES: Record<ReportKind, ReportTemplate> = {
  'executive-dashboard': {
    kind: 'executive-dashboard',
    title: 'Executive Dashboard',
    description: 'High-level performance summary with KPIs, alerts, execution health, learning and opportunities.',
    buildSections: executiveDashboardSections,
  },
  seo: { kind: 'seo', title: 'SEO Report', description: 'SEO health and search performance trends.', buildSections: seoSections },
  kpi: { kind: 'kpi', title: 'KPI Report', description: 'KPI snapshot with previous-period deltas.', buildSections: kpiSections },
  trends: { kind: 'trends', title: 'Trends Report', description: 'All tracked series over the period.', buildSections: trendsTemplateSections },
  alerts: { kind: 'alerts', title: 'Alerts Report', description: 'Alert volume and execution health.', buildSections: alertsTemplateSections },
};

/** Resolves a template by kind; `undefined`/`null` defaults to the executive dashboard. */
export function getTemplate(kind: ReportKind | null | undefined): ReportTemplate {
  if (kind === null || kind === undefined) return TEMPLATES['executive-dashboard'];
  const template = TEMPLATES[kind];
  if (template === undefined) {
    throw new ReportValidationError(`Unknown report template '${kind}'.`);
  }
  return template;
}

export { TEMPLATES };

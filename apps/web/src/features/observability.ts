import { createApiFunctions } from './api-helpers.js';
import { badgeEl, cardEl, tableEl } from '../ui/primitives.js';
import { gridEl, pageHeaderEl } from '../ui/layout.js';
import { kpiCardEl } from './shared-render.js';
import { className, h } from '../vdom.js';
import type { ApiClient } from '../api/client.js';
import type { Alert, BadgeTone, MetricPoint, Severity, TimelineEvent, VNode } from '../types.js';

export interface MetricSummary {
  latest: number;
  min: number;
  max: number;
  avg: number;
}

/** Summarizes a metric series. */
export function summarizeSeries(points: readonly MetricPoint[]): MetricSummary {
  if (points.length === 0) {
    return { latest: 0, min: 0, max: 0, avg: 0 };
  }
  const values = points.map((point) => point.value);
  const latest = values[values.length - 1] ?? 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { latest, min, max, avg };
}

/** Badge tone for an alert severity. */
export function alertSeverityTone(severity: Severity): BadgeTone {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    case 'low':
      return 'info';
    default:
      return 'neutral';
  }
}

/** Tone for a timeline event status. */
export function timelineStatusTone(status: TimelineEvent['status']): BadgeTone {
  switch (status) {
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'error':
      return 'danger';
    case 'running':
      return 'info';
    default:
      return 'neutral';
  }
}

/** Filters alerts to those not yet acknowledged. */
export function unacknowledgedAlerts(alerts: readonly Alert[]): Alert[] {
  return alerts.filter((alert) => !alert.acknowledged);
}

/** Renders the observability page: metrics, alerts and timeline. */
export function renderObservabilityPage(model: {
  series: Record<string, MetricPoint[]>;
  alerts: Alert[];
  timeline: TimelineEvent[];
  canAcknowledge: boolean;
}): VNode {
  const metricCards = Object.entries(model.series).map(([name, points]) => {
    const summary = summarizeSeries(points);
    return kpiCardEl({ id: name, label: name, value: String(summary.latest), tone: summary.latest > summary.avg ? 'success' : 'warning' });
  });

  const alertRows = model.alerts.map((alert) => ({
    title: alert.title,
    store: alert.storeId,
    severity: badgeEl({ label: alert.severity, tone: alertSeverityTone(alert.severity) }),
    acknowledged: alert.acknowledged ? 'Yes' : 'No',
    actions: model.canAcknowledge && !alert.acknowledged
      ? h('a', { class: className('btn', 'btn--secondary'), href: '#', 'data-action': `obs:ack:${alert.id}` }, 'Acknowledge')
      : '—',
  }));

  const alertsTable = tableEl({
    id: 'alerts-table',
    caption: 'Alerts',
    columns: [
      { key: 'title', label: 'Alert' },
      { key: 'store', label: 'Store' },
      { key: 'severity', label: 'Severity' },
      { key: 'acknowledged', label: 'Acknowledged' },
      { key: 'actions', label: 'Actions' },
    ],
    rows: alertRows,
    emptyText: 'No alerts to show.',
  });

  const timelineItems = model.timeline
    .slice()
    .sort((a, b) => b.at - a.at)
    .map((event) =>
      h(
        'li',
        { class: 'timeline__item', key: event.id },
        h('span', { class: className('timeline__dot', `timeline__dot--${event.status}`) }),
        h('div', {}, h('strong', {}, event.title), h('time', {}, new Date(event.at).toLocaleString())),
      ),
    );

  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'Observability', subtitle: 'Metrics, alerts and activity across the platform' }),
    gridEl(metricCards, { sm: 1, md: 2, lg: 4 }),
    gridEl(
      [cardEl({ title: 'Alerts', children: [alertsTable] }), cardEl({ title: 'Timeline', children: [h('ul', { class: 'timeline' }, ...timelineItems)] })],
      { sm: 1, lg: 2 },
    ),
  );
}

/** REST wrappers for observability endpoints. */
export function createObsApi(api: ApiClient) {
  const call = createApiFunctions(api);
  return {
    overview() {
      return call.get<Record<string, MetricPoint[]>>('obsOverview');
    },
    metrics() {
      return call.get<Record<string, MetricPoint[]>>('obsMetrics');
    },
    alerts() {
      return call.get<Alert[]>('obsAlerts');
    },
    timeline() {
      return call.get<TimelineEvent[]>('obsTimeline');
    },
    acknowledge(id: string) {
      return call.post<Alert>('alertsAcknowledge', undefined, { id });
    },
  };
}

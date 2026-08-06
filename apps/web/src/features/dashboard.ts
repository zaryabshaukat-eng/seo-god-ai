import { badgeEl, cardEl } from '../ui/primitives.js';
import { colEl, gridEl, pageHeaderEl } from '../ui/layout.js';
import { className, h } from '../vdom.js';
import type { Alert, BadgeTone, DashboardKpis, MetricPoint, Permission, VNode } from '../types.js';

/** Formats a number for display. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/** Percentage change between a previous and current value. */
export function changePct(previous: number, current: number): number {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }
  return ((current - previous) / previous) * 100;
}

/** Percentage change across a trend series (first to last point). */
export function trendChangePct(points: readonly MetricPoint[]): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return 0;
  }
  return changePct(first.value, last.value);
}

export interface KpiCardModel {
  id: string;
  label: string;
  value: string;
  changePct?: number;
  tone: BadgeTone;
}

/** Builds the dashboard KPI cards from the overview payload. */
export function dashboardKpiCards(kpis: DashboardKpis): KpiCardModel[] {
  const toneFor = (change?: number): BadgeTone => {
    if (change === undefined || change === 0) {
      return 'neutral';
    }
    return change > 0 ? 'success' : 'danger';
  };
  return [
    { id: 'seo-score', label: 'SEO score', value: `${kpis.seoScore}/100`, changePct: kpis.seoScoreChangePct, tone: toneFor(kpis.seoScoreChangePct) },
    { id: 'traffic', label: 'Organic traffic', value: formatNumber(kpis.traffic), changePct: kpis.trafficChangePct, tone: toneFor(kpis.trafficChangePct) },
    { id: 'conversions', label: 'Conversions', value: formatNumber(kpis.conversions), changePct: kpis.conversionsChangePct, tone: toneFor(kpis.conversionsChangePct) },
    { id: 'open-recommendations', label: 'Open recommendations', value: formatNumber(kpis.openRecommendations), tone: 'info' },
    { id: 'pending-executions', label: 'Executions awaiting approval', value: formatNumber(kpis.executionsPending), tone: kpis.executionsPending > 0 ? 'warning' : 'neutral' },
    { id: 'critical-issues', label: 'Critical issues', value: formatNumber(kpis.issuesCritical), tone: kpis.issuesCritical > 0 ? 'danger' : 'neutral' },
  ];
}

/** Renders a single KPI card with its change badge. */
export function kpiCardEl(card: KpiCardModel): VNode {
  const change =
    card.changePct !== undefined ? badgeEl({ label: `${card.changePct > 0 ? '+' : ''}${card.changePct.toFixed(1)}%`, tone: card.tone }) : undefined;
  return h(
    'div',
    { class: 'kpi-card', id: `kpi-${card.id}` },
    h('div', { class: 'kpi-card__value' }, card.value),
    h('div', { class: 'kpi-card__label' }, card.label),
    change,
  );
}

/** Renders a bar chart from a trend series (accessibly labeled). */
export function trendChartEl(points: readonly MetricPoint[], label = 'Traffic trend'): VNode {
  const values = points.map((point) => point.value);
  const max = Math.max(0, ...values, 1);
  const bars = points.map((point, index) => {
    const height = Math.round((point.value / max) * 100);
    return h('span', {
      class: 'chart__bar',
      style: `height:${height}%`,
      role: 'img',
      'aria-label': `${label}: ${formatNumber(point.value)}`,
      key: index,
    });
  });
  return h('div', { class: 'chart', role: 'figure' }, h('h3', { class: 'chart__title' }, label), h('div', { class: 'chart__track' }, ...bars));
}

export interface DashboardQuickAction {
  id: string;
  label: string;
  href: string;
  dataAction: string;
}

/** Quick actions visible for the given permissions. */
export function quickActions(permissions: readonly Permission[]): DashboardQuickAction[] {
  const actions: DashboardQuickAction[] = [];
  if (permissions.includes('crawl.write')) {
    actions.push({ id: 'start-crawl', label: 'Start crawl', href: '/crawls', dataAction: 'navigate:/crawls' });
  }
  if (permissions.includes('seo.read')) {
    actions.push({ id: 'view-seo', label: 'View recommendations', href: '/seo', dataAction: 'navigate:/seo' });
  }
  if (permissions.includes('execution.write')) {
    actions.push({ id: 'approve-executions', label: 'Approve executions', href: '/executions', dataAction: 'navigate:/executions' });
  }
  return actions;
}

export interface DashboardPageModel {
  kpis: DashboardKpis;
  trend: MetricPoint[];
  alerts: Alert[];
  recentAlertsCount: number;
  permissions: readonly Permission[];
}

/** Renders the full dashboard page. */
export function renderDashboardPage(model: DashboardPageModel): VNode {
  const cards = dashboardKpiCards(model.kpis).map(kpiCardEl);
  const chart = trendChartEl(model.trend);
  const actions = quickActions(model.permissions).map((action) =>
    h('a', { class: className('btn', 'btn--secondary'), href: action.href, 'data-action': action.dataAction }, action.label),
  );

  const alertItems = model.alerts.slice(0, model.recentAlertsCount).map((alert) =>
    h('li', { class: 'dashboard-list__item', key: alert.id }, badgeEl({ label: alert.severity, tone: alertTone(alert.severity) }), h('span', {}, alert.title)),
  );

  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({
      title: 'Dashboard',
      subtitle: 'Overview of your store health and AI activity',
      actions,
    }),
    gridEl(cards, { sm: 1, md: 2, lg: 3 }),
    gridEl(
      [
        colEl([cardEl({ title: 'Traffic trend', children: [chart] })], { sm: 12, md: 8, lg: 8 }),
        colEl(
          [
            cardEl({
              title: 'Recent alerts',
              children: [
                model.alerts.length === 0 ? h('p', { class: 'muted' }, 'No alerts to show.') : h('ul', { class: 'dashboard-list' }, ...alertItems),
              ],
            }),
          ],
          { sm: 12, md: 4, lg: 4 },
        ),
      ],
      { sm: 1, lg: 12 },
    ),
  );
}

function alertTone(severity: Alert['severity']): BadgeTone {
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

export { alertTone };

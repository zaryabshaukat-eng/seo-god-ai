import { describe, expect, it } from 'vitest';
import { renderToString } from '../vdom.js';
import { Permissions } from '../api/endpoints.js';
import type { DashboardKpis } from '../types.js';
import {
  alertTone,
  changePct,
  dashboardKpiCards,
  formatNumber,
  kpiCardEl,
  quickActions,
  renderDashboardPage,
  trendChangePct,
  trendChartEl,
} from './dashboard.js';

const KPIS: DashboardKpis = {
  seoScore: 74,
  seoScoreChangePct: 3.2,
  traffic: 12500,
  trafficChangePct: -1.5,
  conversions: 340,
  conversionsChangePct: 0,
  openRecommendations: 12,
  executionsPending: 4,
  issuesCritical: 1,
  crawlPages: 800,
};

describe('formatNumber', () => {
  it('formats with thousand separators', () => {
    expect(formatNumber(12500)).toBe('12,500');
  });
});

describe('changePct', () => {
  it('computes relative change', () => {
    expect(changePct(100, 110)).toBe(10);
    expect(changePct(100, 90)).toBe(-10);
  });

  it('handles a zero baseline', () => {
    expect(changePct(0, 0)).toBe(0);
    expect(changePct(0, 5)).toBe(100);
  });
});

describe('trendChangePct', () => {
  it('compares first to last point', () => {
    expect(trendChangePct([{ t: 1, value: 100 }, { t: 2, value: 110 }])).toBe(10);
  });

  it('returns zero for empty series', () => {
    expect(trendChangePct([])).toBe(0);
  });
});

describe('dashboardKpiCards', () => {
  it('builds all six KPI cards with tones', () => {
    const cards = dashboardKpiCards(KPIS);
    expect(cards).toHaveLength(6);
    expect(cards[0]).toMatchObject({ id: 'seo-score', value: '74/100', tone: 'success' });
    expect(cards[1]).toMatchObject({ id: 'traffic', value: '12,500', tone: 'danger' });
    expect(cards[2]).toMatchObject({ id: 'conversions', tone: 'neutral' });
    expect(cards[3]).toMatchObject({ id: 'open-recommendations', tone: 'info' });
    expect(cards[4]).toMatchObject({ id: 'pending-executions', tone: 'warning' });
    expect(cards[5]).toMatchObject({ id: 'critical-issues', tone: 'danger' });
  });
});

describe('kpiCardEl', () => {
  it('renders the value, label and change badge', () => {
    const html = renderToString(kpiCardEl({ id: 'traffic', label: 'Organic traffic', value: '12,500', changePct: -1.5, tone: 'danger' }));
    expect(html).toContain('id="kpi-traffic"');
    expect(html).toContain('>12,500</div>');
    expect(html).toContain('-1.5%');
  });

  it('omits the change badge when absent', () => {
    const html = renderToString(kpiCardEl({ id: 'open-recommendations', label: 'Open', value: '12', tone: 'info' }));
    expect(html).not.toContain('badge');
  });
});

describe('trendChartEl', () => {
  it('renders a bar per point with accessible labels', () => {
    const html = renderToString(trendChartEl([{ t: 1, value: 50 }, { t: 2, value: 100 }], 'Traffic trend'));
    expect(html).toContain('role="figure"');
    expect(html).toContain('class="chart__title"');
    expect(html).toContain('aria-label="Traffic trend: 50"');
    expect(html).toContain('style="height:100%"');
  });
});

describe('quickActions', () => {
  it('shows actions by permission', () => {
    expect(quickActions([])).toEqual([]);
    const actions = quickActions([Permissions.crawlWrite, Permissions.seoRead, Permissions.executionWrite]);
    expect(actions.map((action) => action.id)).toEqual(['start-crawl', 'view-seo', 'approve-executions']);
  });
});

describe('alertTone', () => {
  it('maps severities to tones', () => {
    expect(alertTone('critical')).toBe('danger');
    expect(alertTone('high')).toBe('danger');
    expect(alertTone('medium')).toBe('warning');
    expect(alertTone('low')).toBe('info');
    expect(alertTone('info' as never)).toBe('neutral');
  });
});

describe('renderDashboardPage', () => {
  it('renders the full page', () => {
    const html = renderToString(
      renderDashboardPage({
        kpis: KPIS,
        trend: [{ t: 1, value: 10 }],
        alerts: [{ id: 'a1', title: 'Down', severity: 'high', storeId: 's1', message: 'm', acknowledged: false, createdAt: 0 }],
        recentAlertsCount: 5,
        permissions: [Permissions.crawlWrite],
      }),
    );
    expect(html).toContain('Dashboard');
    expect(html).toContain('kpi-card');
    expect(html).toContain('Traffic trend');
    expect(html).toContain('Recent alerts');
    expect(html).toContain('data-action="navigate:/crawls"');
  });

  it('renders an empty alert message', () => {
    const html = renderToString(
      renderDashboardPage({ kpis: KPIS, trend: [], alerts: [], recentAlertsCount: 5, permissions: [] }),
    );
    expect(html).toContain('No alerts to show.');
  });
});

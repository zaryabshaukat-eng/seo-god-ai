import { describe, expect, it } from 'vitest';
import { renderToString } from '../vdom.js';
import type { Alert } from '../types.js';
import { alertSeverityTone, createObsApi, renderObservabilityPage, summarizeSeries, timelineStatusTone, unacknowledgedAlerts } from './observability.js';

describe('summarizeSeries', () => {
  it('summarizes a series', () => {
    const summary = summarizeSeries([{ t: 1, value: 10 }, { t: 2, value: 30 }, { t: 3, value: 20 }]);
    expect(summary).toEqual({ latest: 20, min: 10, max: 30, avg: 20 });
  });

  it('handles an empty series', () => {
    expect(summarizeSeries([])).toEqual({ latest: 0, min: 0, max: 0, avg: 0 });
  });
});

describe('alertSeverityTone', () => {
  it('maps severities', () => {
    expect(alertSeverityTone('critical')).toBe('danger');
    expect(alertSeverityTone('high')).toBe('danger');
    expect(alertSeverityTone('medium')).toBe('warning');
    expect(alertSeverityTone('low')).toBe('info');
    expect(alertSeverityTone('info' as never)).toBe('neutral');
  });
});

describe('timelineStatusTone', () => {
  it('maps statuses', () => {
    expect(timelineStatusTone('success')).toBe('success');
    expect(timelineStatusTone('warning')).toBe('warning');
    expect(timelineStatusTone('error')).toBe('danger');
    expect(timelineStatusTone('running')).toBe('info');
    expect(timelineStatusTone('idle' as never)).toBe('neutral');
  });
});

describe('unacknowledgedAlerts', () => {
  it('filters acknowledged alerts', () => {
    const alerts: Alert[] = [
      { id: 'a', title: 'x', storeId: 's', severity: 'high', acknowledged: false, message: 'm', createdAt: 0 },
      { id: 'b', title: 'y', storeId: 's', severity: 'low', acknowledged: true, message: 'm', createdAt: 0 },
    ];
    expect(unacknowledgedAlerts(alerts).map((a) => a.id)).toEqual(['a']);
  });
});

describe('renderObservabilityPage', () => {
  const alerts: Alert[] = [{ id: 'a1', title: 'High latency', storeId: 's1', severity: 'high', acknowledged: false, message: 'm', createdAt: 0 }];

  it('renders metrics, alerts and timeline', () => {
    const html = renderToString(
      renderObservabilityPage({
        series: { latency: [{ t: 1, value: 10 }, { t: 2, value: 100 }] },
        alerts,
        timeline: [{ id: 't1', at: 100, type: 'alert', title: 'Fired', status: 'error' }],
        canAcknowledge: true,
      }),
    );
    expect(html).toContain('id="alerts-table"');
    expect(html).toContain('data-action="obs:ack:a1"');
    expect(html).toContain('class="timeline"');
  });

  it('shows no acknowledge action for acknowledged alerts', () => {
    const html = renderToString(
      renderObservabilityPage({
        series: {},
        alerts: [{ ...alerts[0] as Alert, acknowledged: true }],
        timeline: [],
        canAcknowledge: true,
      }),
    );
    expect(html).not.toContain('obs:ack:');
    expect(html).toContain('>Yes</td>');
  });

  it('shows an empty alerts state', () => {
    const html = renderToString(
      renderObservabilityPage({ series: {}, alerts: [], timeline: [], canAcknowledge: false }),
    );
    expect(html).not.toContain('obs:ack:');
    expect(html).toContain('No alerts to show.');
  });

  it('warns when the latest metric is below the average', () => {
    const html = renderToString(
      renderObservabilityPage({
        series: { latency: [{ t: 1, value: 10 }, { t: 2, value: 5 }, { t: 3, value: 0 }] },
        alerts: [],
        timeline: [],
        canAcknowledge: false,
      }),
    );
    expect(html).toContain('kpi-card--warning');
  });
});

describe('createObsApi', () => {
  it('wraps observability endpoints onto the client', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const api = {
      request: async <T>(method: string, url: string, body: unknown): Promise<T> => {
        calls.push({ method, url, body });
        return { ok: true } as T;
      },
    } as never;
    const obsApi = createObsApi(api);
    await obsApi.overview();
    await obsApi.metrics();
    await obsApi.alerts();
    await obsApi.timeline();
    await obsApi.acknowledge('a1');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/v1/observability/overview',
      'GET /api/v1/observability/metrics',
      'GET /api/v1/observability/alerts',
      'GET /api/v1/observability/timeline',
      'POST /api/v1/observability/alerts/a1/acknowledge',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '@seogod/monitoring';
import { ENTERPRISE_METRIC_PREFIX, EnterpriseMetrics } from './metrics.js';

describe('EnterpriseMetrics', () => {
  it('records metrics against the registry snapshot', () => {
    const registry = new MetricsRegistry();
    const metrics = new EnterpriseMetrics(registry);
    metrics.tenantLifecycle('provisioned');
    metrics.apiKey('issued');
    metrics.webhookDelivery('delivered');
    metrics.webhookDelivery('failed');
    metrics.seatsInUse('t1', 12);
    metrics.auditRecorded();
    metrics.authorizationDenied();

    const snapshot = registry.snapshot();
    expect(snapshot.counters[`${ENTERPRISE_METRIC_PREFIX}_tenant_provisioned`]).toBe(1);
    expect(snapshot.counters[`${ENTERPRISE_METRIC_PREFIX}_apikey_issued`]).toBe(1);
    expect(snapshot.counters[`${ENTERPRISE_METRIC_PREFIX}_webhook_delivered`]).toBe(1);
    expect(snapshot.counters[`${ENTERPRISE_METRIC_PREFIX}_webhook_failed`]).toBe(1);
    expect(snapshot.counters[`${ENTERPRISE_METRIC_PREFIX}_auth_denied`]).toBe(1);
    expect(snapshot.gauges[`${ENTERPRISE_METRIC_PREFIX}_seats_${hash('t1')}`]).toBe(12);
    expect(snapshot.histograms[`${ENTERPRISE_METRIC_PREFIX}_audit`]).toBeDefined();
  });

  it('no-ops when no registry is attached', () => {
    const metrics = new EnterpriseMetrics();
    expect(() => {
      metrics.tenantLifecycle('suspended');
      metrics.apiKey('revoked');
      metrics.webhookDelivery('failed');
      metrics.seatsInUse('t1', 1);
      metrics.auditRecorded();
      metrics.authorizationDenied();
    }).not.toThrow();
  });
});

function hash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

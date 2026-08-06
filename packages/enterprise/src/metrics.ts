/**
 * Enterprise metrics: thin facade over `@seogod/monitoring`'s
 * `MetricsRegistry` (the only runtime dependency besides `@seogod/core`).
 * All metric names are namespaced with `ent_` and surfaced as
 * Prometheus-compatible counters and histograms via the registry snapshot.
 */

import type { MetricsRegistry } from '@seogod/monitoring';

export const ENTERPRISE_METRIC_PREFIX = 'ent';

/** Records enterprise telemetry; no-ops when no registry is attached. */
export class EnterpriseMetrics {
  private readonly registry: MetricsRegistry | null;

  constructor(registry?: MetricsRegistry) {
    this.registry = registry ?? null;
  }

  /** Counter of tenant lifecycle transitions (provisioned/suspended/…). */
  tenantLifecycle(action: string): void {
    this.registry?.increment(`${ENTERPRISE_METRIC_PREFIX}_tenant_${action}`);
  }

  /** Counter of API key issuance/revocation events. */
  apiKey(action: string): void {
    this.registry?.increment(`${ENTERPRISE_METRIC_PREFIX}_apikey_${action}`);
  }

  /** Counter of webhook deliveries, labelled by outcome. */
  webhookDelivery(outcome: 'delivered' | 'failed'): void {
    this.registry?.increment(`${ENTERPRISE_METRIC_PREFIX}_webhook_${outcome}`);
  }

  /** Gauge of seats in use for a tenant (reports a bounded id per tenant). */
  seatsInUse(tenantId: string, count: number): void {
    this.registry?.setGauge(`${ENTERPRISE_METRIC_PREFIX}_seats_${hashTenant(tenantId)}`, count);
  }

  /** Histogram of audit records written per operation. */
  auditRecorded(): void {
    this.registry?.observe(`${ENTERPRISE_METRIC_PREFIX}_audit`, 1);
  }

  /** Counter of authorization denials. */
  authorizationDenied(): void {
    this.registry?.increment(`${ENTERPRISE_METRIC_PREFIX}_auth_denied`);
  }
}

function hashTenant(tenantId: string): string {
  let hash = 0;
  for (let index = 0; index < tenantId.length; index += 1) {
    hash = (hash * 31 + tenantId.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

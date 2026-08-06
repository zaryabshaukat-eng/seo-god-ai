/**
 * Report metrics: thin facade over `@seogod/monitoring`'s `MetricsRegistry`
 * (the only runtime dependency besides `@seogod/core`). All metric names are
 * namespaced with `report_` and surfaced as Prometheus-compatible counters
 * and histograms through the registry snapshot.
 */

import type { MetricsRegistry } from '@seogod/monitoring';
import type { Report, ReportFormat } from './types.js';

export const REPORT_METRIC_PREFIX = 'report';

function counterName(kind: string, storeId?: string): string {
  const store = storeId === undefined ? 'unknown' : storeId;
  return `${REPORT_METRIC_PREFIX}_generated_${kind}_${store}`;
}

/** Records reporting telemetry; no-ops when no registry is attached. */
export class ReportMetrics {
  private readonly registry: MetricsRegistry | null;

  constructor(registry?: MetricsRegistry) {
    this.registry = registry ?? null;
  }

  /** Counter of generated reports, labelled by kind + store. */
  reportGenerated(report: Report): void {
    this.registry?.increment(counterName(report.kind, report.storeId));
  }

  /** Counter of rendered outputs, labelled by format. */
  reportRendered(format: ReportFormat): void {
    this.registry?.increment(`${REPORT_METRIC_PREFIX}_rendered_${format}`);
  }

  /** Histogram of rendering wall-time in milliseconds, labelled by format. */
  reportRenderTime(format: ReportFormat, durationMs: number): void {
    this.registry?.observe(`${REPORT_METRIC_PREFIX}_render_${format}`, durationMs);
  }

  /** Histogram of rendered output size in bytes, labelled by format. */
  reportRenderedBytes(format: ReportFormat, bytes: number): void {
    this.registry?.observe(`${REPORT_METRIC_PREFIX}_bytes_${format}`, bytes);
  }

  /** Counter of failures, labelled by kind. */
  reportFailed(kind: string): void {
    this.registry?.increment(`${REPORT_METRIC_PREFIX}_failed_${kind}`);
  }
}

/** Byte size of a rendered value (string or binary buffer). */
export function renderedBytes(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (value instanceof Uint8Array) return value.byteLength;
  return 0;
}

export interface MetricSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, { count: number; sum: number; min: number; max: number; avg: number }>;
}

const PREFIX = 'seogod_';

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Lightweight in-memory metrics registry (counters, gauges, timings).
 * Snapshot output is compatible with a Prometheus text exposition.
 */
export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  observe(name: string, valueMs: number): void {
    const bucket = this.histograms.get(name) ?? [];
    bucket.push(valueMs);
    this.histograms.set(name, bucket);
  }

  snapshot(): MetricSnapshot {
    const histograms: MetricSnapshot['histograms'] = {};
    for (const [name, values] of this.histograms) {
      const sum = values.reduce((total, value) => total + value, 0);
      histograms[name] = {
        count: values.length,
        sum,
        min: Math.min(...values),
        max: Math.max(...values),
        avg: sum / values.length,
      };
    }
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms,
    };
  }

  /** Renders the snapshot in Prometheus text exposition format. */
  render(): string {
    const snapshot = this.snapshot();
    const lines: string[] = [];
    for (const [name, value] of Object.entries(snapshot.counters)) {
      const key = `${PREFIX}${sanitize(name)}_total`;
      lines.push(`# TYPE ${key} counter`, `${key} ${value}`);
    }
    for (const [name, value] of Object.entries(snapshot.gauges)) {
      const key = `${PREFIX}${sanitize(name)}`;
      lines.push(`# TYPE ${key} gauge`, `${key} ${value}`);
    }
    for (const [name, stats] of Object.entries(snapshot.histograms)) {
      const key = `${PREFIX}${sanitize(name)}_milliseconds`;
      lines.push(
        `# TYPE ${key} histogram`,
        `${key}_count ${stats.count}`,
        `${key}_sum ${stats.sum}`,
        `${key}_max ${stats.max}`,
      );
    }
    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

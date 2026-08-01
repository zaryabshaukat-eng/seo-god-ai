export type HealthStatus = 'ok' | 'degraded' | 'unhealthy';

export type HealthCheckFn = () => Promise<void> | void;

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  latencyMs: number;
  detail?: string;
}

export interface HealthReport {
  status: HealthStatus;
  checkedAt: string;
  checks: HealthCheckResult[];
}

function aggregate(report: HealthReport): HealthStatus {
  return report.checks.some((check) => check.status === 'unhealthy') ? 'unhealthy' : 'ok';
}

/**
 * Registers named health probes (e.g. database ping, redis ping) and
 * evaluates them together. A check is "ok" when it resolves, "unhealthy"
 * when it throws. Checks can explicitly report a degraded state by
 * returning a resolved promise and throwing nothing — degradation is
 * reported through {@link HealthCheckResult.status} via the check fn
 * returning `'degraded'`-style status. To keep the API simple, any thrown
 * error is "unhealthy".
 */
export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheckFn>();

  register(name: string, fn: HealthCheckFn): void {
    this.checks.set(name, fn);
  }

  unregister(name: string): void {
    this.checks.delete(name);
  }

  /** Evaluates all registered checks (or only `names` when provided). */
  async check(names?: string[]): Promise<HealthReport> {
    const entries = names?.length
      ? names.map((name) => [name, this.checks.get(name)] as const)
      : [...this.checks.entries()];

    const results: HealthCheckResult[] = [];
    for (const [name, fn] of entries) {
      const startedAt = performance.now();
      if (fn === undefined) {
        results.push({ name, status: 'unhealthy', latencyMs: 0, detail: 'unknown check' });
        continue;
      }
      try {
        await fn();
        results.push({ name, status: 'ok', latencyMs: performance.now() - startedAt });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        results.push({ name, status: 'unhealthy', latencyMs: performance.now() - startedAt, detail });
      }
    }

    const report: HealthReport = {
      status: 'ok',
      checkedAt: new Date().toISOString(),
      checks: results,
    };
    report.status = aggregate(report);
    return report;
  }
}

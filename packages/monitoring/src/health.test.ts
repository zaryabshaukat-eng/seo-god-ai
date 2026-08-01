import { describe, expect, it, vi } from 'vitest';
import { HealthRegistry } from './health.js';

describe('HealthRegistry', () => {
  it('reports ok when all checks pass', async () => {
    const registry = new HealthRegistry();
    registry.register('database', () => Promise.resolve());
    registry.register('redis', () => undefined);
    const report = await registry.check();
    expect(report.status).toBe('ok');
    expect(report.checks).toHaveLength(2);
    expect(report.checks[0]?.status).toBe('ok');
    expect(report.checkedAt).toBeTruthy();
  });

  it('marks a check unhealthy when it throws', async () => {
    const registry = new HealthRegistry();
    registry.register('database', () => {
      throw new Error('connection refused');
    });
    const report = await registry.check();
    expect(report.status).toBe('unhealthy');
    expect(report.checks[0]).toMatchObject({ status: 'unhealthy', detail: 'connection refused' });
  });

  it('records latency in milliseconds', async () => {
    const registry = new HealthRegistry();
    registry.register('slow', () => new Promise<void>((resolve) => setTimeout(resolve, 20)));
    const report = await registry.check();
    expect(report.checks[0]?.latencyMs).toBeGreaterThanOrEqual(10);
  });

  it('checks only the requested names', async () => {
    const registry = new HealthRegistry();
    const ping = vi.fn();
    registry.register('database', ping);
    registry.register('redis', ping);
    const report = await registry.check(['database']);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.name).toBe('database');
  });

  it('flags unknown requested checks as unhealthy', async () => {
    const registry = new HealthRegistry();
    const report = await registry.check(['database']);
    expect(report.status).toBe('unhealthy');
    expect(report.checks[0]?.detail).toBe('unknown check');
  });

  it('records a stringified detail for non-Error throws', async () => {
    const registry = new HealthRegistry();
    registry.register('database', () => {
      throw 'boom';
    });
    const report = await registry.check();
    expect(report.checks[0]).toMatchObject({ status: 'unhealthy', detail: 'boom' });
  });

  it('deletes a check on unregister', async () => {
    const registry = new HealthRegistry();
    registry.register('database', () => undefined);
    registry.unregister('database');
    const report = await registry.check();
    expect(report.checks).toHaveLength(0);
    expect(report.status).toBe('ok');
  });
});

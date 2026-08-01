import { afterEach, describe, expect, it } from 'vitest';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import type { ServerResponse } from 'node:http';
import { HealthRegistry } from './health.js';
import { MetricsRegistry } from './metrics.js';
import { MonitoringServer } from './server.js';

const servers: MonitoringServer[] = [];

function makeResponse(): { res: ServerResponse; captured: { body: string; status: number } } {
  const captured = { body: '', status: 200 };
  const res = {
    writeHead(status: number) {
      captured.status = status;
      return res;
    },
    end(body: string) {
      captured.body = body;
      return res;
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

async function startServer(
  options: Partial<ConstructorParameters<typeof MonitoringServer>[0]> = {},
): Promise<MonitoringServer> {
  const registry = new HealthRegistry();
  registry.register('database', () => undefined);
  registry.register('redis', () => {
    throw new Error('not reachable');
  });
  const server = new MonitoringServer({
    port: 0,
    registry,
    metrics: new MetricsRegistry(),
    ...options,
  });
  await server.start();
  servers.push(server);
  return server;
}

function baseUrl(server: MonitoringServer): string {
  return `http://127.0.0.1:${server.boundPort}`;
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (server) await server.stop();
  }
});

describe('MonitoringServer', () => {
  it('serves liveness on /health', async () => {
    const server = await startServer();
    const res = await fetch(`${baseUrl(server)}/health`);
    expect(res.status).toBe(200);
    const report = (await res.json()) as { status: string; checks: { name: string }[] };
    expect(report.status).toBe('unhealthy');
    expect(report.checks).toHaveLength(2);
  });

  it('returns 503 on /ready when a required check fails', async () => {
    const server = await startServer();
    const res = await fetch(`${baseUrl(server)}/ready`);
    expect(res.status).toBe(503);
  });

  it('returns 200 on /ready when all required checks pass', async () => {
    const server = await startServer({ readinessChecks: ['database'] });
    const res = await fetch(`${baseUrl(server)}/ready`);
    expect(res.status).toBe(200);
  });

  it('exposes rendered metrics on /metrics', async () => {
    const metrics = new MetricsRegistry();
    metrics.increment('events.processed', 7);
    const server = await startServer({ metrics });
    const res = await fetch(`${baseUrl(server)}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('seogod_events_processed_total 7');
  });

  it('responds 404 for unknown routes', async () => {
    const server = await startServer();
    const res = await fetch(`${baseUrl(server)}/nope`);
    expect(res.status).toBe(404);
  });

  it('is idempotent when started twice', async () => {
    const server = await startServer();
    await server.start();
    const res = await fetch(`${baseUrl(server)}/health`);
    expect(res.status).toBe(200);
  });

  it('reports no bound port before start', () => {
    const server = new MonitoringServer({ port: 0, registry: new HealthRegistry(), metrics: new MetricsRegistry() });
    expect(server.boundPort).toBeUndefined();
  });

  it('stop before start is a no-op', async () => {
    const server = new MonitoringServer({ port: 0, registry: new HealthRegistry(), metrics: new MetricsRegistry() });
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('falls back to the configured port when none is given', async () => {
    const probe = await new Promise<NetServer>((resolve, reject) => {
      const server = createNetServer();
      server.once('error', reject);
      server.listen(0, () => resolve(server));
    });
    const freePort = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const previous = process.env.PORT;
    process.env.PORT = String(freePort);
    try {
      const server = new MonitoringServer({ registry: new HealthRegistry(), metrics: new MetricsRegistry() });
      await server.start();
      servers.push(server);
      expect(server.boundPort).toBe(freePort);
    } finally {
      if (previous === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = previous;
      }
    }
  });

  it('treats a missing url as the root route', async () => {
    const server = await startServer();
    const { res, captured } = makeResponse();
    await server.handle({ url: undefined } as never, res);
    expect(captured.status).toBe(404);
  });
});

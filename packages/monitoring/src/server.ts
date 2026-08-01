import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getConfig } from '@seogod/config';
import type { HealthRegistry } from './health.js';
import type { MetricsRegistry } from './metrics.js';

export interface MonitoringServerOptions {
  /** HTTP port. Defaults to `config.app.port`. */
  port?: number;
  registry: HealthRegistry;
  metrics: MetricsRegistry;
  /** Checks consulted by `/ready`. Defaults to all registered checks. */
  readinessChecks?: string[];
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Exposes `/health` (liveness), `/ready` (readiness) and `/metrics`
 * (Prometheus text exposition) on a dedicated HTTP server.
 */
export class MonitoringServer {
  private server?: Server;
  private readonly port: number;

  constructor(private readonly options: MonitoringServerOptions) {
    this.port = options.port ?? getConfig().app.port;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, () => resolve());
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Actual bound port (useful when the server bound to port 0). */
  get boundPort(): number | undefined {
    const address = this.server?.address();
    return typeof address === 'object' && address !== null ? address.port : undefined;
  }

  /** Dispatches an incoming request to the matching route. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = req.url ? new URL(req.url, 'http://localhost').pathname : '/';
    if (pathname === '/health') {
      writeJson(res, 200, await this.options.registry.check());
      return;
    }
    if (pathname === '/ready') {
      const report = await this.options.registry.check(this.options.readinessChecks);
      writeJson(res, report.status === 'ok' ? 200 : 503, report);
      return;
    }
    if (pathname === '/metrics') {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(this.options.metrics.render());
      return;
    }
    writeJson(res, 404, { error: 'Not found' });
  }
}

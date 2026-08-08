/**
 * HTTP server. Builds the router (via `createApiRouter`), owns the raw
 * `node:http` server and runs every request through the middleware pipeline:
 *
 *   1. request id + access log
 *   2. CORS (including preflight)
 *   3. body parsing (JSON, size-limited)
 *   4. context construction
 *   5. route dispatch (404 / 405)
 *   6. error normalization to the canonical JSON error envelope
 *
 * `/health`, `/ready` and `/metrics` are served from the platform's own
 * registries so a single process exposes everything an orchestrator needs.
 */

import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Platform } from './platform.js';
import { Router, requireRouteMatch } from './router.js';
import { createContext } from './context.js';
import { MethodNotAllowedError, NotFoundError, errorBody, toApiError } from './errors.js';
import {
  applyCors,
  clientIp,
  methodOf,
  parseUrl,
  readJsonBody,
  sendJson,
  sendText,
} from './http.js';
import type { HttpMethod } from './http.js';
import { registerAuthRoutes } from './controllers/auth.js';
import { registerDashboardRoutes, registerObservabilityRoutes } from './controllers/dashboard.js';
import { registerCrawlRoutes, registerExecutionRoutes, registerSeoRoutes } from './controllers/crawls.js';
import { registerReportRoutes } from './controllers/reports.js';
import { registerCopilotRoutes } from './controllers/copilot.js';
import { registerAdminRoutes } from './controllers/admin.js';
import { registerSettingsRoutes } from './controllers/settings.js';
import { registerNotificationRoutes } from './controllers/notifications.js';
import { registerWebhookRoutes } from './controllers/webhooks.js';
import { registerPluginRoutes } from './controllers/plugins.js';
import { RealtimeHub, registerRealtimeRoutes, wireRealtimeToEventBus } from './realtime.js';
import { registerOpenApiRoutes } from './openapi.js';
import { registerSdkRoutes } from './sdk.js';

export interface ApiServerOptions {
  /** HTTP port. Defaults to `config.app.port`; `0` binds a random port. */
  port?: number;
  /** Host to bind. Defaults to all interfaces. */
  host?: string;
  /** Extra routes registered after the platform routes. */
  routes?: (router: Router) => void;
  /** Client CORS origin. Defaults to `*`. */
  corsOrigin?: string;
}

export class ApiServer {
  private server?: Server;
  private readonly port: number;
  private readonly host: string;
  private readonly corsOrigin: string;
  private readonly router: Router;
  readonly realtime: RealtimeHub;

  constructor(
    private readonly platform: Platform,
    options: ApiServerOptions = {},
  ) {
    this.port = options.port ?? platform.config.app.port;
    this.host = options.host ?? '0.0.0.0';
    this.corsOrigin = options.corsOrigin ?? '*';
    this.realtime = new RealtimeHub();
    this.router = createApiRouter(platform, this.realtime);
    options.routes?.(this.router);
  }

  /** Starts listening. Resolves once the socket is bound. */
  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => resolve());
    });
    this.server = server;
  }

  /** Closes the listener, draining in-flight requests. */
  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  /** The port the server is bound to (useful when `port: 0`). */
  get boundPort(): number | undefined {
    const address = this.server?.address();
    return typeof address === 'object' && address !== null ? address.port : undefined;
  }

  /** Every registered route, for tests and tooling. */
  get routeTable() {
    return this.router.list();
  }

  /** Dispatches a single request through the middleware pipeline. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = requestIdOf(req);
    res.setHeader('x-request-id', requestId);
    applyCors(res, this.corsOrigin);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const startedAt = Date.now();
    const ip = clientIp(req);
    const { pathname, query } = parseUrl(req);
    const method = methodOf(req);

    if (pathname === '/health') {
      sendJson(res, 200, await this.platform.health.check());
      return;
    }
    if (pathname === '/ready') {
      const report = await this.platform.health.check();
      sendJson(res, report.status === 'ok' ? 200 : 503, report);
      return;
    }
    if (pathname === '/metrics') {
      sendText(res, 200, this.platform.metrics.render(), 'text/plain; version=0.0.4; charset=utf-8');
      return;
    }

    try {
      await this.dispatch(req, res, { requestId, method, pathname, query, ip });
    } catch (error) {
      this.handleError(res, error, { requestId, method, pathname, ip, startedAt });
      return;
    }
    const durationMs = Date.now() - startedAt;
    this.platform.logger.info(
      { requestId, method, pathname, status: res.statusCode, durationMs, ip },
      'request complete',
    );
  }

  private async dispatch(
    req: IncomingMessage,
    res: ServerResponse,
    info: { requestId: string; method: HttpMethod; pathname: string; query: URLSearchParams; ip: string },
  ): Promise<void> {
    if (!this.router.pathExists(info.pathname)) {
      throw new NotFoundError(`No route for ${info.method} ${info.pathname}.`);
    }
    if (!this.router.methodExists(info.method, info.pathname)) {
      throw new MethodNotAllowedError(`Method ${info.method} is not allowed for ${info.pathname}.`);
    }
    const match = requireRouteMatch(this.router, info.method, info.pathname);
    const body = needsBody(info.method) ? await readJsonBody(req) : undefined;
    const ctx = createContext({
      requestId: info.requestId,
      method: info.method,
      pathname: info.pathname,
      query: info.query,
      headers: req.headers,
      body,
      ip: info.ip,
      logger: this.platform.logger.child({ requestId: info.requestId }),
      res,
    });
    ctx.params = match.params;
    await match.handler(ctx);
  }

  private handleError(
    res: ServerResponse,
    error: unknown,
    info: { requestId: string; method: HttpMethod; pathname: string; ip: string; startedAt: number },
  ): void {
    const apiError = toApiError(error);
    const durationMs = Date.now() - info.startedAt;
    if (apiError.status >= 500) {
      this.platform.logger.error(
        {
          requestId: info.requestId,
          method: info.method,
          pathname: info.pathname,
          ip: info.ip,
          err: apiError.cause ?? error,
        },
        'request failed',
      );
    } else {
      this.platform.logger.warn(
        { requestId: info.requestId, method: info.method, pathname: info.pathname, ip: info.ip, status: apiError.status },
        'request rejected',
      );
    }
    if (apiError.status === 429) {
      const retryAfterMs = (error as { retryAfterMs?: number }).retryAfterMs ?? 1000;
      res.setHeader('retry-after', String(Math.ceil(retryAfterMs / 1000)));
    }
    sendJson(res, apiError.status, errorBody(apiError));
    void durationMs;
  }
}

/**
 * Builds the router with every controller registered. Platform routes are
 * registered first, then the optional caller routes.
 */
export function createApiRouter(platform: Platform, realtime?: RealtimeHub): Router {
  const router = new Router();
  registerPlatformRoutes(platform, router, realtime);
  return router;
}

/** Registers every controller module onto the router. Returns the realtime hub. */
export function registerPlatformRoutes(platform: Platform, router: Router, realtime?: RealtimeHub): RealtimeHub {
  const hub = realtime ?? new RealtimeHub();
  wireRealtimeToEventBus(hub, platform.eventBus);
  registerAuthRoutes(platform, router);
  registerDashboardRoutes(platform, router);
  registerObservabilityRoutes(platform, router);
  registerCrawlRoutes(platform, router);
  registerSeoRoutes(platform, router);
  registerExecutionRoutes(platform, router);
  registerReportRoutes(platform, router);
  registerCopilotRoutes(platform, router);
  registerAdminRoutes(platform, router);
  registerSettingsRoutes(platform, router);
  registerNotificationRoutes(platform, router);
  registerWebhookRoutes(platform, router);
  registerPluginRoutes(platform, router);
  registerOpenApiRoutes(platform, router);
  registerSdkRoutes(platform, router);
  registerRealtimeRoutes(platform, router, hub);
  return hub;
}

function requestIdOf(req: IncomingMessage): string {
  const header = req.headers['x-request-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  return randomBytes(8).toString('hex');
}

function needsBody(method: HttpMethod): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH';
}

/**
 * Webhook endpoints: manage outbound webhook endpoints and inspect delivery
 * history. Delivery itself is handled by `@seogod/enterprise` with retries,
 * backoff and HMAC signing; this controller exposes management + a manual
 * test dispatch so integrations can verify their receiver.
 */

import type { Platform } from '../platform.js';
import type { Router } from '../router.js';
import { bodyAs, requireParam } from '../context.js';
import { NotFoundError } from '../errors.js';
import { guard } from '../guards.js';
import { sendJson, sendNoContent } from '../http.js';
import { PlatformPermissions } from '../permissions.js';
import { optionalArray, optionalString, requireString } from '../validation.js';

function endpointShape(endpoint: {
  webhookId: string;
  url: string;
  events: readonly string[];
  enabled: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}): Record<string, unknown> {
  return {
    id: endpoint.webhookId,
    url: endpoint.url,
    events: [...endpoint.events],
    enabled: endpoint.enabled,
    description: endpoint.description,
    createdAt: Date.parse(endpoint.createdAt),
    updatedAt: Date.parse(endpoint.updatedAt),
  };
}

export function registerWebhookRoutes(platform: Platform, router: Router): void {
  router.on(
    'GET',
    '/api/v1/admin/webhooks',
    guard(platform, { permission: PlatformPermissions.adminRead }, async (ctx) => {
      const endpoints = await platform.enterprise.webhooks.listEndpoints(ctx.tenantId ?? '');
      sendJson(ctx.res, 200, { webhooks: endpoints.map(endpointShape) });
    }),
  );

  router.on(
    'POST',
    '/api/v1/admin/webhooks',
    guard(platform, { permission: PlatformPermissions.adminWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const url = requireString(body, 'url', 'URL');
      const events = optionalArray(body, 'events').map(String);
      if (events.length === 0) {
        events.push('store.updated');
      }
      const description = optionalString(body, 'description');
      const endpoint = platform.enterprise.webhooks.register(ctx.tenantId ?? '', {
        url,
        events,
        description,
      });
      sendJson(ctx.res, 201, { webhook: endpointShape(endpoint) });
    }),
  );

  router.on(
    'PATCH',
    '/api/v1/admin/webhooks/:id',
    guard(platform, { permission: PlatformPermissions.adminWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const tenantId = ctx.tenantId ?? '';
      const id = requireParam(ctx, 'id');
      const existing = await platform.enterprise.webhooks.getEndpoint(tenantId, id).catch(() => null);
      if (existing === null) {
        throw new NotFoundError(`Webhook '${id}' not found.`);
      }
      const endpoint = await platform.enterprise.webhooks.updateEndpoint(tenantId, id, {
        url: optionalString(body, 'url'),
        events: body.events === undefined ? undefined : optionalArray(body, 'events').map(String),
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        description: optionalString(body, 'description'),
      });
      sendJson(ctx.res, 200, { webhook: endpointShape(endpoint) });
    }),
  );

  router.on(
    'DELETE',
    '/api/v1/admin/webhooks/:id',
    guard(platform, { permission: PlatformPermissions.adminWrite }, async (ctx) => {
      const tenantId = ctx.tenantId ?? '';
      const id = requireParam(ctx, 'id');
      await platform.enterprise.webhooks.getEndpoint(tenantId, id).catch(() => {
        throw new NotFoundError(`Webhook '${id}' not found.`);
      });
      await platform.enterprise.webhooks.removeEndpoint(tenantId, id);
      sendNoContent(ctx.res);
    }),
  );

  router.on(
    'GET',
    '/api/v1/admin/webhooks/deliveries',
    guard(platform, { permission: PlatformPermissions.adminRead }, async (ctx) => {
      const attempts = platform.enterprise.webhooks.listDeliveries(ctx.tenantId ?? '');
      sendJson(ctx.res, 200, {
        deliveries: attempts.map((attempt) => ({
          id: attempt.attemptId,
          webhookId: attempt.webhookId,
          eventId: attempt.eventId,
          status: attempt.status,
          attemptNumber: attempt.attemptNumber,
          httpStatus: attempt.httpStatus,
          error: attempt.error,
          attemptedAt: Date.parse(attempt.attemptedAt),
        })),
      });
    }),
  );

  router.on(
    'POST',
    '/api/v1/admin/webhooks/:id/test',
    guard(platform, { permission: PlatformPermissions.adminWrite }, async (ctx) => {
      const tenantId = ctx.tenantId ?? '';
      const id = requireParam(ctx, 'id');
      const endpoint = await platform.enterprise.webhooks.getEndpoint(tenantId, id).catch(() => null);
      if (endpoint === null) {
        throw new NotFoundError(`Webhook '${id}' not found.`);
      }
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const event = {
        id: platform.id(),
        tenantId,
        type: optionalString(body, 'type') ?? 'store.updated',
        createdAt: new Date(platform.now().getTime()).toISOString(),
        payload:
          typeof body.payload === 'object' && body.payload !== null && !Array.isArray(body.payload)
            ? (body.payload as Record<string, unknown>)
            : { ok: true },
      };
      const result = await platform.enterprise.webhooks.deliver(endpoint, event, {
        attempts: 1,
        backoffMs: 0,
      });
      sendJson(ctx.res, 200, {
        delivered: result.delivered,
        attempts: result.attempts.length,
      });
    }),
  );
}

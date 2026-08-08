/**
 * Notifications endpoints: list, mark read, mark all read. Notifications are
 * per-tenant and created by the platform (e.g. from observability alerts) or
 * through the admin/dev create endpoint.
 */

import type { Platform } from '../platform.js';
import type { Router } from '../router.js';
import { bodyAs, requireParam } from '../context.js';
import { NotFoundError } from '../errors.js';
import { guard } from '../guards.js';
import { sendJson } from '../http.js';
import { PlatformPermissions } from '../permissions.js';
import { optionalString, requireEnum, requireString } from '../validation.js';

const SEVERITIES = ['info', 'warning', 'critical'] as const;

function notificationShape(notification: {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: string;
  read: boolean;
  createdAt: string;
}): Record<string, unknown> {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    severity: notification.severity,
    read: notification.read,
    createdAt: Date.parse(notification.createdAt),
  };
}

export function registerNotificationRoutes(platform: Platform, router: Router): void {
  router.on(
    'GET',
    '/api/v1/notifications',
    guard(platform, { permission: PlatformPermissions.notificationsRead }, async (ctx) => {
      const tenantId = ctx.tenantId ?? '';
      const notifications = platform.notifications.list(tenantId).map(notificationShape);
      sendJson(ctx.res, 200, {
        notifications,
        unreadCount: platform.notifications.unreadCount(tenantId),
      });
    }),
  );

  router.on(
    'POST',
    '/api/v1/notifications',
    guard(platform, { permission: PlatformPermissions.notificationsRead }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const notification = platform.notifications.create({
        tenantId: ctx.tenantId ?? '',
        type: requireString(body, 'type', 'Type'),
        title: requireString(body, 'title', 'Title'),
        message: requireString(body, 'message', 'Message'),
        severity: optionalString(body, 'severity') === undefined
          ? undefined
          : requireEnum(body, 'severity', SEVERITIES, 'Severity'),
      });
      sendJson(ctx.res, 201, { notification: notificationShape(notification) });
    }),
  );

  router.on(
    'POST',
    '/api/v1/notifications/:id/read',
    guard(platform, { permission: PlatformPermissions.notificationsRead }, async (ctx) => {
      const tenantId = ctx.tenantId ?? '';
      const id = requireParam(ctx, 'id');
      let notification;
      try {
        notification = platform.notifications.markRead(tenantId, id);
      } catch {
        throw new NotFoundError(`Notification '${id}' not found.`);
      }
      sendJson(ctx.res, 200, { notification: notificationShape(notification) });
    }),
  );

  router.on(
    'POST',
    '/api/v1/notifications/read-all',
    guard(platform, { permission: PlatformPermissions.notificationsRead }, async (ctx) => {
      const tenantId = ctx.tenantId ?? '';
      const marked = platform.notifications.markAllRead(tenantId);
      sendJson(ctx.res, 200, { marked });
    }),
  );
}

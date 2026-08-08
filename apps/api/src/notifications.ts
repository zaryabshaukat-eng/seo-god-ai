/**
 * In-memory notification store backing the notifications endpoints. Entries
 * are per-tenant; a notification is created either by the platform (from
 * observability alerts) or directly by tests/dev flows.
 */

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface Notification {
  id: string;
  tenantId: string;
  type: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  read: boolean;
  createdAt: string;
}

export interface NotificationsServiceOptions {
  now?: () => string;
  id?: () => string;
}

export class NotificationsService {
  private readonly notifications: Notification[] = [];
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(options: NotificationsServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => `n_${Math.random().toString(36).slice(2, 10)}`);
  }

  create(input: {
    tenantId: string;
    type: string;
    title: string;
    message: string;
    severity?: NotificationSeverity;
  }): Notification {
    const notification: Notification = {
      id: this.id(),
      tenantId: input.tenantId,
      type: input.type,
      title: input.title,
      message: input.message,
      severity: input.severity ?? 'info',
      read: false,
      createdAt: this.now(),
    };
    this.notifications.push(notification);
    return notification;
  }

  list(tenantId: string): Notification[] {
    return this.notifications
      .filter((entry) => entry.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  markRead(tenantId: string, id: string): Notification {
    const entry = this.notifications.find(
      (candidate) => candidate.tenantId === tenantId && candidate.id === id,
    );
    if (entry === undefined) {
      throw new Error(`Notification '${id}' not found for tenant '${tenantId}'.`);
    }
    entry.read = true;
    return entry;
  }

  markAllRead(tenantId: string): number {
    let count = 0;
    for (const entry of this.notifications) {
      if (entry.tenantId === tenantId && !entry.read) {
        entry.read = true;
        count += 1;
      }
    }
    return count;
  }

  unreadCount(tenantId: string): number {
    return this.notifications.filter((entry) => entry.tenantId === tenantId && !entry.read).length;
  }

  reset(): void {
    this.notifications.length = 0;
  }
}

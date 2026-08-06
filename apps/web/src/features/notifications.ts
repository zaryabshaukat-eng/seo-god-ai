import { badgeEl, buttonEl, cardEl } from '../ui/primitives.js';
import { gridEl, pageHeaderEl } from '../ui/layout.js';
import { className, h } from '../vdom.js';
import type { BadgeTone, NotificationItem, NotificationKind, VNode } from '../types.js';

/** Badge tone for a notification kind. */
export function notificationTone(kind: NotificationKind): BadgeTone {
  switch (kind) {
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'error':
    case 'alert':
      return 'danger';
    default:
      return 'info';
  }
}

/** Counts unread notifications. */
export function unreadCount(items: readonly NotificationItem[]): number {
  return items.filter((item) => !item.read).length;
}

/** Renders the notifications center page. */
export function renderNotificationsPage(model: {
  items: NotificationItem[];
  canMarkAll: boolean;
}): VNode {
  const unread = unreadCount(model.items);
  const items = model.items.map((item) => {
    const markRead = !item.read
      ? buttonEl({
          label: 'Mark as read',
          variant: 'ghost',
          dataAction: `notification:read:${item.id}`,
          ariaLabel: `Mark ${item.title} as read`,
        })
      : undefined;
    return h(
      'li',
      { class: className('notification', !item.read && 'notification--unread'), key: item.id },
      badgeEl({ label: item.kind, tone: notificationTone(item.kind) }),
      h('div', { class: 'notification__body' }, h('strong', {}, item.title), item.message ? h('p', {}, item.message) : undefined, h('time', {}, new Date(item.createdAt).toLocaleString())),
      markRead,
    );
  });

  const markAll = model.canMarkAll && unread > 0
    ? buttonEl({ label: `Mark all as read (${unread})`, variant: 'secondary', dataAction: 'notification:read-all' })
    : undefined;

  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'Notifications', subtitle: `${unread} unread`, actions: markAll ? [markAll] : undefined }),
    gridEl([
      cardEl({
        title: 'Inbox',
        children: [
          model.items.length === 0
            ? h('p', { class: 'muted' }, 'You are all caught up.')
            : h('ul', { class: 'notification-list' }, ...items),
        ],
      }),
    ]),
  );
}

import { describe, expect, it } from 'vitest';
import { renderToString } from '../vdom.js';
import type { NotificationItem } from '../types.js';
import { notificationTone, renderNotificationsPage, unreadCount } from './notifications.js';

const ITEMS: NotificationItem[] = [
  { id: 'n1', kind: 'success', title: 'Crawl finished', message: '120 pages', createdAt: 1700000000000, read: false },
  { id: 'n2', kind: 'error', title: 'Execution failed', message: 'boom', createdAt: 1700000000001, read: true },
  { id: 'n3', kind: 'alert', title: 'SEO alert', createdAt: 1700000000002, read: false },
];

describe('notificationTone', () => {
  it('maps kinds to tones', () => {
    expect(notificationTone('success')).toBe('success');
    expect(notificationTone('warning')).toBe('warning');
    expect(notificationTone('error')).toBe('danger');
    expect(notificationTone('alert')).toBe('danger');
    expect(notificationTone('info')).toBe('info');
  });
});

describe('unreadCount', () => {
  it('counts unread items', () => {
    expect(unreadCount(ITEMS)).toBe(2);
    expect(unreadCount([])).toBe(0);
  });
});

describe('renderNotificationsPage', () => {
  it('renders unread badges and mark-as-read buttons', () => {
    const html = renderToString(renderNotificationsPage({ items: ITEMS, canMarkAll: true }));
    expect(html).toContain('notification--unread');
    expect(html).toContain('data-action="notification:read:n1"');
    expect(html).toContain('data-action="notification:read-all"');
    expect(html).toContain('2 unread');
    expect(html).toContain('badge--danger');
  });

  it('shows a caught-up state without mark-all', () => {
    const html = renderToString(renderNotificationsPage({ items: [], canMarkAll: false }));
    expect(html).toContain('You are all caught up.');
    expect(html).not.toContain('notification:read-all');
  });
});

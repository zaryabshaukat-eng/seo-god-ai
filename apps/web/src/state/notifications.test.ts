import { describe, expect, it, vi } from 'vitest';
import { createNotificationsApi, createNotificationsStore, type NotificationsApi } from './notifications.js';
import type { ApiClient } from '../api/client.js';
import type { NotificationItem } from '../types.js';

function item(id: string, read = false): NotificationItem {
  return { id, title: `Notification ${id}`, kind: 'info', read, createdAt: 1 };
}

function makeApi(overrides: Partial<NotificationsApi> = {}): NotificationsApi {
  return {
    list: vi.fn(async () => [item('a'), item('b', true)]),
    markRead: vi.fn(async () => undefined),
    markAllRead: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createNotificationsStore', () => {
  it('starts idle and empty', () => {
    const store = createNotificationsStore(makeApi());
    expect(store.getState().status).toBe('idle');
    expect(store.unread()).toBe(0);
    expect(store.hasUnread()).toBe(false);
  });

  it('loads notifications and computes the unread count', async () => {
    const store = createNotificationsStore(makeApi());
    await store.load();
    expect(store.getState().status).toBe('ready');
    expect(store.getItems()).toHaveLength(2);
    expect(store.unread()).toBe(1);
    expect(store.hasUnread()).toBe(true);
  });

  it('marks a load failure', async () => {
    const api = makeApi({
      list: vi.fn(async () => {
        throw new Error('down');
      }),
    });
    const store = createNotificationsStore(api);
    await store.load();
    expect(store.getState().status).toBe('error');
    expect(store.getState().error).toBe('down');
  });

  it('marks an item as read and syncs with the API', async () => {
    const api = makeApi();
    const store = createNotificationsStore(api);
    await store.load();
    await store.markRead('a');
    expect(store.unread()).toBe(0);
    expect(api.markRead).toHaveBeenCalledWith('a');
  });

  it('surfaces an error when marking read fails', async () => {
    const api = makeApi({
      markRead: vi.fn(async () => {
        throw new Error('nope');
      }),
    });
    const store = createNotificationsStore(api);
    await store.load();
    await store.markRead('a');
    expect(store.getState().error).toBe('nope');
    expect(store.unread()).toBe(0);
  });

  it('marks everything as read', async () => {
    const api = makeApi();
    const store = createNotificationsStore(api);
    await store.load();
    await store.markAllRead();
    expect(store.unread()).toBe(0);
    expect(api.markAllRead).toHaveBeenCalledOnce();
  });

  it('surfaces an error when marking all read fails', async () => {
    const api = makeApi({
      markAllRead: vi.fn(async () => {
        throw new Error('nope');
      }),
    });
    const store = createNotificationsStore(api);
    await store.load();
    await store.markAllRead();
    expect(store.getState().error).toBe('nope');
  });

  it('adds pushed notifications and deduplicates by id', () => {
    const store = createNotificationsStore(makeApi());
    store.add(item('x'));
    store.add(item('y'));
    store.add(item('x', true));
    expect(store.getItems()).toHaveLength(2);
    expect(store.getItems()[0]?.id).toBe('x');
    expect(store.getItems()[0]?.read).toBe(true);
  });

  it('removes a notification', () => {
    const store = createNotificationsStore(makeApi());
    store.add(item('z'));
    store.remove('z');
    expect(store.getItems()).toHaveLength(0);
  });

  it('notifies subscribers', async () => {
    const store = createNotificationsStore(makeApi());
    const listener = vi.fn();
    store.subscribe((state) => listener(state));
    await store.load();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }));
  });
});

describe('createNotificationsApi', () => {
  const stubApi = (): ApiClient => ({
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  });

  it('maps list, markRead and markAllRead onto endpoints', async () => {
    const api = stubApi();
    const notifications = createNotificationsApi(api);
    await notifications.list();
    expect(api.get).toHaveBeenCalledWith('/api/v1/notifications');
    await notifications.markRead('n1');
    expect(api.post).toHaveBeenCalledWith('/api/v1/notifications/n1/read');
    await notifications.markAllRead();
    expect(api.post).toHaveBeenCalledWith('/api/v1/notifications/read-all');
  });
});

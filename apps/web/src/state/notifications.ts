import { createStore } from '../store.js';
import { toWebError, errorMessage } from '../errors.js';
import type { ApiClient } from '../api/client.js';
import { endpointPath } from '../api/endpoints.js';
import type { NotificationItem } from '../types.js';

export interface NotificationsApi {
  list(): Promise<NotificationItem[]>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}

export interface NotificationsState {
  items: NotificationItem[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
}

export interface NotificationsStore {
  getState(): NotificationsState;
  getItems(): NotificationItem[];
  unread(): number;
  hasUnread(): boolean;
  load(): Promise<void>;
  /** Appends a pushed notification (deduplicated by id). */
  add(item: NotificationItem): void;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  remove(id: string): void;
  subscribe(listener: (state: NotificationsState) => void): () => void;
}

/** Notifications API wired to the REST client. */
export function createNotificationsApi(api: ApiClient): NotificationsApi {
  return {
    list() {
      return api.get<NotificationItem[]>(endpointPath('notificationsList'));
    },
    markRead(id: string) {
      return api.post(endpointPath('notificationsMarkRead', { id }));
    },
    markAllRead() {
      return api.post(endpointPath('notificationsMarkAllRead'));
    },
  };
}

/** Creates the notification center store. */
export function createNotificationsStore(api: NotificationsApi): NotificationsStore {
  const store = createStore<NotificationsState>({ items: [], status: 'idle' });

  async function load(): Promise<void> {
    store.set((state) => ({ ...state, status: 'loading', error: undefined }));
    try {
      const items = await api.list();
      store.set({ items, status: 'ready', error: undefined });
    } catch (error) {
      store.set((state) => ({ ...state, status: 'error', error: errorMessage(toWebError(error)) }));
    }
  }

  async function markRead(id: string): Promise<void> {
    store.set((state) => ({
      ...state,
      items: state.items.map((item) => (item.id === id ? { ...item, read: true } : item)),
    }));
    try {
      await api.markRead(id);
    } catch (error) {
      store.set((state) => ({ ...state, error: errorMessage(toWebError(error)) }));
    }
  }

  async function markAllRead(): Promise<void> {
    store.set((state) => ({ ...state, items: state.items.map((item) => ({ ...item, read: true })) }));
    try {
      await api.markAllRead();
    } catch (error) {
      store.set((state) => ({ ...state, error: errorMessage(toWebError(error)) }));
    }
  }

  return {
    getState: () => store.get(),
    getItems: () => store.get().items,
    unread: () => store.get().items.filter((item) => !item.read).length,
    hasUnread: () => store.get().items.some((item) => !item.read),
    load,
    add(item: NotificationItem) {
      store.set((state) => ({
        ...state,
        items: [item, ...state.items.filter((existing) => existing.id !== item.id)],
      }));
    },
    markRead,
    markAllRead,
    remove(id: string) {
      store.set((state) => ({ ...state, items: state.items.filter((item) => item.id !== id) }));
    },
    subscribe: (listener) => store.subscribe(listener),
  };
}

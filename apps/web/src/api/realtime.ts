import type { RealtimeTransport } from '../types.js';

export type RealtimeStatus = 'disconnected' | 'connecting' | 'connected';

export interface RealtimeConfig {
  transport: RealtimeTransport;
  /** Delay between reconnect attempts in ms. */
  reconnectDelayMs?: number;
  /** Maximum number of reconnect attempts before giving up. */
  maxReconnectAttempts?: number;
}

export interface RealtimeClient {
  connect(): Promise<void>;
  disconnect(): void;
  get status(): RealtimeStatus;
  subscribe(channel: string, handler: (payload: unknown) => void): () => void;
  unsubscribe(channel: string): void;
  publish(channel: string, payload: unknown): void;
  channels(): string[];
  onStatus(handler: (status: RealtimeStatus) => void): () => void;
}

const DEFAULT_RECONNECT_DELAY_MS = 2_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;

interface ChannelHandlers {
  handler: (payload: unknown) => void;
}

/**
 * Real-time client for pushing updates into the UI. Subscribes to named
 * channels, publishes events (echoed locally) and transparently reconnects
 * with bounded exponential backoff.
 */
export function createRealtime(config: RealtimeConfig): RealtimeClient {
  const delayMs = config.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const maxAttempts = config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;

  let status: RealtimeStatus = 'disconnected';
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const subscriptions = new Map<string, Set<ChannelHandlers>>();
  const statusListeners = new Set<(status: RealtimeStatus) => void>();

  function setStatus(next: RealtimeStatus) {
    if (status === next) {
      return;
    }
    status = next;
    for (const listener of statusListeners) {
      listener(status);
    }
  }

  function notify(channel: string, payload: unknown) {
    const handlers = subscriptions.get(channel);
    if (!handlers) {
      return;
    }
    for (const { handler } of handlers) {
      handler(payload);
    }
  }

  async function attemptConnect(): Promise<void> {
    if (disposed) {
      return;
    }
    setStatus('connecting');
    try {
      await config.transport.connect();
      if (disposed) {
        return;
      }
      attempt = 0;
      setStatus('connected');
    } catch {
      if (disposed) {
        return;
      }
      attempt += 1;
      if (attempt > maxAttempts) {
        setStatus('disconnected');
        return;
      }
      reconnectTimer = setTimeout(() => {
        void attemptConnect();
      }, delayMs * attempt);
    }
  }

  config.transport.onMessage((channel, payload) => {
    notify(channel, payload);
  });

  return {
    async connect() {
      if (status === 'connecting' || status === 'connected') {
        return;
      }
      await attemptConnect();
    },
    disconnect() {
      disposed = true;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      config.transport.disconnect();
      setStatus('disconnected');
    },
    get status() {
      return status;
    },
    subscribe(channel: string, handler: (payload: unknown) => void) {
      let handlers = subscriptions.get(channel);
      if (!handlers) {
        handlers = new Set();
        subscriptions.set(channel, handlers);
      }
      const entry: ChannelHandlers = { handler };
      handlers.add(entry);
      return () => {
        const current = subscriptions.get(channel);
        if (current) {
          current.delete(entry);
          if (current.size === 0) {
            subscriptions.delete(channel);
          }
        }
      };
    },
    unsubscribe(channel: string) {
      subscriptions.delete(channel);
    },
    publish(channel: string, payload: unknown) {
      config.transport.send(channel, payload);
      notify(channel, payload);
    },
    channels() {
      return [...subscriptions.keys()];
    },
    onStatus(handler: (status: RealtimeStatus) => void) {
      statusListeners.add(handler);
      return () => {
        statusListeners.delete(handler);
      };
    },
  };
}

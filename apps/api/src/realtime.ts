/**
 * Real-time event hub + Server-Sent Events transport. The hub is a small
 * in-memory pub/sub keyed by channel name; the HTTP layer exposes an SSE
 * subscription endpoint (EventSource-compatible via `access_token`) and a
 * publish endpoint. The platform event bus (crawler completion/failure, …)
 * can be wired into the hub so clients receive domain events as they happen.
 */

import type { EventBus } from '@seogod/events';
import type { Platform } from './platform.js';
import type { Router } from './router.js';
import { bodyAs } from './context.js';
import { guard } from './guards.js';
import { sendJson } from './http.js';
import { PlatformPermissions } from './permissions.js';
import { requireString } from './validation.js';

export interface RealtimeEvent {
  channel: string;
  payload: unknown;
  publishedAt: string;
}

export type RealtimeHandler = (event: RealtimeEvent) => void;

const HISTORY_LIMIT = 50;

export class RealtimeHub {
  private readonly subscriptions = new Map<string, Set<RealtimeHandler>>();
  private readonly history = new Map<string, RealtimeEvent[]>();
  private readonly now: () => string;

  constructor(options: { now?: () => string } = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Subscribes `handler` to `channel`; returns an unsubscribe function. */
  subscribe(channel: string, handler: RealtimeHandler): () => void {
    let handlers = this.subscriptions.get(channel);
    if (handlers === undefined) {
      handlers = new Set<RealtimeHandler>();
      this.subscriptions.set(channel, handlers);
    }
    handlers.add(handler);
    return () => this.unsubscribe(channel, handler);
  }

  /** Removes a single handler from a channel. */
  unsubscribe(channel: string, handler: RealtimeHandler): void {
    const handlers = this.subscriptions.get(channel);
    if (handlers === undefined) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.subscriptions.delete(channel);
    }
  }

  /** Removes every subscription on a channel. */
  unsubscribeChannel(channel: string): void {
    this.subscriptions.delete(channel);
  }

  /** Publishes `payload` to `channel`, notifying every subscriber. */
  publish(channel: string, payload: unknown): RealtimeEvent {
    const event: RealtimeEvent = { channel, payload, publishedAt: this.now() };
    const handlers = this.subscriptions.get(channel);
    if (handlers !== undefined) {
      for (const handler of handlers) {
        handler(event);
      }
    }
    if (channel !== '*') {
      const wildcard = this.subscriptions.get('*');
      if (wildcard !== undefined) {
        for (const handler of wildcard) {
          handler(event);
        }
      }
    }
    const history = this.history.get(channel) ?? [];
    history.push(event);
    this.history.set(channel, history.slice(-HISTORY_LIMIT));
    return event;
  }

  /** Most recent events published on `channel`, oldest first. */
  recent(channel: string, limit = HISTORY_LIMIT): RealtimeEvent[] {
    return [...(this.history.get(channel) ?? [])].slice(-limit);
  }

  /** Every channel that has active subscriptions. */
  channels(): string[] {
    return [...this.subscriptions.keys()];
  }

  /** Number of active handlers for a channel. */
  subscribers(channel: string): number {
    return this.subscriptions.get(channel)?.size ?? 0;
  }

  /** Clears all subscriptions and history. */
  clear(): void {
    this.subscriptions.clear();
    this.history.clear();
  }
}

const PLATFORM_EVENT_CHANNELS: ReadonlyArray<{ type: string; channel: string }> = [
  { type: 'crawl.completed', channel: 'crawls' },
  { type: 'crawl.failed', channel: 'crawls' },
];

/**
 * Forwards platform outbox events to the hub. Subscribes the hub to the
 * crawler lifecycle events (delivered through the transactional outbox) and
 * republishes them on their mapped channel so SSE clients get push updates.
 * The event bus offers no unsubscribe, so the returned cleanup is a no-op
 * kept for symmetry with subscription APIs.
 */
export function wireRealtimeToEventBus(hub: RealtimeHub, eventBus: EventBus): () => void {
  for (const { type, channel } of PLATFORM_EVENT_CHANNELS) {
    eventBus.subscribe(type, (event) => {
      hub.publish(channel, {
        type: event.type,
        id: event.id,
        aggregateId: event.aggregateId,
        payload: event.payload,
      });
    });
  }
  return () => undefined;
}

function sseEnvelope(event: RealtimeEvent): string {
  return `event: ${event.channel}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}

/** Registers the real-time HTTP endpoints on the router. */
export function registerRealtimeRoutes(platform: Platform, router: Router, hub: RealtimeHub): void {
  router.on(
    'GET',
    '/api/v1/realtime/events',
    guard(platform, { permission: PlatformPermissions.dashboardRead }, async (ctx) => {
      const raw = ctx.query.get('channel');
      const channels = raw === null || raw.trim().length === 0 ? ['*'] : raw.split(',').map((c) => c.trim());
      const subscription: RealtimeEvent[] = [];

      ctx.res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      ctx.res.write(`retry: 3000\n\n`);

      const unsubscribes: Array<() => void> = [];
      const relay: RealtimeHandler = (event) => {
        if (channels.includes('*') || channels.includes(event.channel)) {
          subscription.push(event);
          ctx.res.write(sseEnvelope(event));
        }
      };
      for (const channel of channels) {
        unsubscribes.push(hub.subscribe(channel === '*' ? channel : channel, relay));
        if (channel !== '*') {
          for (const event of hub.recent(channel)) {
            ctx.res.write(sseEnvelope(event));
          }
        }
      }

      const onClose = () => {
        for (const unsubscribe of unsubscribes) {
          unsubscribe();
        }
        ctx.res.end();
      };
      ctx.res.once('close', onClose);
      ctx.res.once('error', onClose);
    }),
  );

  router.on(
    'POST',
    '/api/v1/realtime/publish',
    guard(platform, { permission: PlatformPermissions.dashboardRead }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const channel = requireString(body, 'channel', 'Channel');
      const event = hub.publish(channel, body.payload);
      sendJson(ctx.res, 200, event);
    }),
  );
}

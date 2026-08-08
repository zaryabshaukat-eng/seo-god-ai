/**
 * Bridges the plugin registry to a platform event bus. Because the platform
 * bus offers no unsubscribe, the bridge subscribes a single dispatcher per
 * event type and leaves it active; dispatch-time filtering (the registry only
 * runs *enabled* subscribers) makes stale subscriptions harmless. Call
 * `sync()` whenever the registry's enabled event types may have changed.
 */

import type { PluginRegistry } from './registry.js';

/** Minimal structural shape of a platform event bus. */
export interface PluginEventBusLike {
  subscribe(type: string, handler: (event: unknown) => void | Promise<void>): void;
}

export class PluginEventBridge {
  private readonly subscribed = new Set<string>();

  constructor(
    private readonly registry: PluginRegistry,
    private readonly bus: PluginEventBusLike,
  ) {}

  /**
   * Ensures every currently-declared event type has a dispatcher wired to the
   * bus. Idempotent; new types are added, existing ones are left untouched.
   */
  sync(): void {
    for (const type of this.registry.eventTypes()) {
      if (this.subscribed.has(type)) continue;
      this.subscribed.add(type);
      this.bus.subscribe(type, (event) => void this.registry.dispatchEvent(type, event as Parameters<PluginRegistry['handleEvent']>[1]));
    }
  }

  /** Event types currently wired to the bus. */
  wiredTypes(): string[] {
    return [...this.subscribed];
  }
}

import { describe, expect, it } from 'vitest';
import { PluginEventBridge, type PluginEventBusLike } from '../src/bridge.js';
import { PluginRegistry } from '../src/registry.js';
import { makeBundle } from '../tests/bundle.js';

class FakeBus implements PluginEventBusLike {
  readonly handlers = new Map<string, (event: unknown) => void>();
  subscribeCount = 0;

  subscribe(type: string, handler: (event: unknown) => void | Promise<void>): void {
    this.subscribeCount += 1;
    this.handlers.set(type, handler);
  }
}

function wiredRegistry(): { registry: PluginRegistry; bus: FakeBus; bridge: PluginEventBridge } {
  const registry = new PluginRegistry();
  registry.install(makeBundle());
  registry.enable('fixture.plugin');
  const bus = new FakeBus();
  const bridge = new PluginEventBridge(registry, bus);
  return { registry, bus, bridge };
}

describe('PluginEventBridge', () => {
  it('subscribes a dispatcher per declared event type', () => {
    const { bus, bridge } = wiredRegistry();
    bridge.sync();
    expect(bus.subscribeCount).toBe(1);
    expect(bus.handlers.has('page.published')).toBe(true);
    expect(bridge.wiredTypes()).toEqual(['page.published']);
  });

  it('is idempotent across repeated sync calls', () => {
    const { bus, bridge } = wiredRegistry();
    bridge.sync();
    bridge.sync();
    expect(bus.subscribeCount).toBe(1);
  });

  it('delivers bus events to enabled subscribers', async () => {
    const { registry, bus, bridge } = wiredRegistry();
    bridge.sync();
    const event = { type: 'page.published', aggregateId: '1', payload: { slug: 'x' } };
    bus.handlers.get('page.published')?.(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(registry.get('fixture.plugin')?.state).toBe('enabled');
  });

  it('wires newly declared event types after install', () => {
    const { registry, bus, bridge } = wiredRegistry();
    bridge.sync();
    const subscriber = { id: 'second', name: 'Second', events: ['order.created'] };
    registry.install(
      makeBundle(
        { id: 'second.plugin', contributions: { eventSubscribers: [subscriber] } },
        { eventSubscribers: { second: 'function () { return undefined; }' } },
      ),
    );
    registry.enable('second.plugin');
    bridge.sync();
    expect(bus.handlers.has('page.published')).toBe(true);
    expect(bus.handlers.has('order.created')).toBe(true);
    expect(bus.subscribeCount).toBe(2);
  });
});

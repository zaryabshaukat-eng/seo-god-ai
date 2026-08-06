import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store.js';

describe('createStore', () => {
  it('starts with the initial value and updates with set', () => {
    const store = createStore(0);
    expect(store.get()).toBe(0);
    store.set(5);
    expect(store.get()).toBe(5);
  });

  it('supports functional updates', () => {
    const store = createStore(0);
    store.set((prev) => prev + 2);
    expect(store.get()).toBe(2);
  });

  it('notifies subscribers synchronously with next and previous values', () => {
    const store = createStore(1);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(2);
    expect(listener).toHaveBeenLastCalledWith(2, 1);
  });

  it('emits the current value immediately on subscribe', () => {
    const store = createStore('a');
    const listener = vi.fn();
    store.subscribe(listener);
    expect(listener).toHaveBeenCalledWith('a', 'a');
  });

  it('skips no-op updates', () => {
    const store = createStore(1);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes listeners', () => {
    const store = createStore(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports unsubscribing from inside select', () => {
    const store = createStore(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('select projects a derived store and only emits on change', () => {
    const store = createStore({ count: 1, label: 'x' });
    const selected = store.select((state) => state.count);
    expect(selected.get()).toBe(1);
    const listener = vi.fn();
    selected.subscribe(listener);
    store.set({ count: 1, label: 'y' });
    expect(listener).toHaveBeenCalledTimes(1);
    store.set({ count: 2, label: 'y' });
    expect(listener).toHaveBeenLastCalledWith(2, 1);
  });

  it('select emits the current selected value on subscribe', () => {
    const store = createStore({ count: 3 });
    const selected = store.select((state) => state.count);
    const listener = vi.fn();
    selected.subscribe(listener);
    expect(listener).toHaveBeenCalledWith(3, 3);
  });

  it('unsubscribes listeners from a selected store', () => {
    const store = createStore({ count: 0 });
    const selected = store.select((state) => state.count);
    const listener = vi.fn();
    const unsubscribe = selected.subscribe(listener);
    unsubscribe();
    store.set({ count: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createThemeStore, resolveTheme } from './theme.js';
import type { ThemeStorage } from './theme.js';

function makeStorage(initial?: 'light' | 'dark' | 'system'): ThemeStorage {
  let pref: 'light' | 'dark' | 'system' | undefined = initial;
  return {
    getPref: () => pref,
    savePref: vi.fn((next) => {
      pref = next;
    }),
  };
}

describe('resolveTheme', () => {
  it('resolves system preference with a fallback', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', undefined)).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });
});

describe('createThemeStore', () => {
  it('defaults to the system theme with a light fallback', () => {
    const store = createThemeStore(makeStorage());
    expect(store.getPref()).toBe('system');
    expect(store.getTheme()).toBe('light');
  });

  it('reads a stored preference', () => {
    const store = createThemeStore(makeStorage('dark'));
    expect(store.getTheme()).toBe('dark');
  });

  it('sets the preference and persists it', () => {
    const storage = makeStorage();
    const store = createThemeStore(storage);
    store.setPref('dark');
    expect(store.getTheme()).toBe('dark');
    expect(storage.savePref).toHaveBeenCalledWith('dark');
  });

  it('resolves the system theme when it changes', () => {
    const store = createThemeStore(makeStorage('system'));
    store.setSystemTheme('dark');
    expect(store.getTheme()).toBe('dark');
  });

  it('keeps the explicit theme while the system changes', () => {
    const store = createThemeStore(makeStorage('light'));
    store.setSystemTheme('dark');
    expect(store.getTheme()).toBe('light');
  });

  it('toggles between light and dark', () => {
    const storage = makeStorage();
    const store = createThemeStore(storage);
    store.toggle();
    expect(store.getTheme()).toBe('dark');
    store.toggle();
    expect(store.getTheme()).toBe('light');
  });

  it('exposes state and notifies subscribers', () => {
    const store = createThemeStore(makeStorage());
    const listener = vi.fn();
    store.subscribe((state) => listener(state));
    store.setSystemTheme('dark');
    expect(store.getState()).toMatchObject({ system: 'dark', resolved: 'dark' });
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ resolved: 'dark' }));
  });
});

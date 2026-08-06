import { createStore } from '../store.js';
import type { ThemeName, ThemePref } from '../types.js';

/** Resolves the effective theme given a preference and system preference. */
export function resolveTheme(pref: ThemePref, system?: ThemeName): ThemeName {
  if (pref === 'system') {
    return system ?? 'light';
  }
  return pref;
}

export interface ThemeStorage {
  getPref(): ThemePref | undefined;
  savePref(pref: ThemePref): void;
}

export interface ThemeState {
  pref: ThemePref;
  system: ThemeName;
  resolved: ThemeName;
}

export interface ThemeStore {
  getState(): ThemeState;
  getPref(): ThemePref;
  getTheme(): ThemeName;
  setPref(pref: ThemePref): void;
  setSystemTheme(theme: ThemeName): void;
  toggle(): void;
  subscribe(listener: (state: ThemeState) => void): () => void;
}

const DEFAULT_SYSTEM = 'light';

/** Creates the theme store. Persists the preference; resolves system vs explicit. */
export function createThemeStore(storage: ThemeStorage): ThemeStore {
  const initialPref = storage.getPref() ?? 'system';
  const store = createStore<ThemeState>({
    pref: initialPref,
    system: DEFAULT_SYSTEM,
    resolved: resolveTheme(initialPref, DEFAULT_SYSTEM),
  });

  function apply(next: Partial<ThemeState>) {
    store.set((state) => {
      const pref = next.pref ?? state.pref;
      const system = next.system ?? state.system;
      return { pref, system, resolved: resolveTheme(pref, system) };
    });
  }

  return {
    getState: () => store.get(),
    getPref: () => store.get().pref,
    getTheme: () => store.get().resolved,
    setPref(pref: ThemePref) {
      storage.savePref(pref);
      apply({ pref });
    },
    setSystemTheme(theme: ThemeName) {
      apply({ system: theme });
    },
    toggle() {
      const next: ThemePref = store.get().resolved === 'dark' ? 'light' : 'dark';
      storage.savePref(next);
      apply({ pref: next });
    },
    subscribe: (listener) => store.subscribe(listener),
  };
}

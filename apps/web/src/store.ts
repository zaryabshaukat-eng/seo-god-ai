/** Minimal observable store powering the Web UI state layer. */

export interface ReadableStore<T> {
  get(): T;
  subscribe(listener: (value: T, prev: T) => void): () => void;
}

export interface Store<T> extends ReadableStore<T> {
  set(next: T | ((prev: T) => T)): void;
  select<S>(selector: (value: T) => S): ReadableStore<S>;
}

/**
 * Creates an observable store. `set` accepts a value or an updater; every
 * subscriber is called synchronously with the new and previous values.
 */
export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<(next: T, prev: T) => void>();

  function emit(next: T) {
    const prev = value;
    value = next;
    for (const listener of listeners) {
      listener(value, prev);
    }
  }

  function subscribe(listener: (next: T, prev: T) => void) {
    listeners.add(listener);
    listener(value, value);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    get() {
      return value;
    },
    set(next: T | ((prev: T) => T)) {
      const updated = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      if (Object.is(updated, value)) {
        return;
      }
      emit(updated);
    },
    subscribe,
    select<S>(selector: (value: T) => S): ReadableStore<S> {
      let selected = selector(value);
      const selectListeners = new Set<(next: S, prev: S) => void>();

      const emitIfChanged = (next: T) => {
        const updated = selector(next);
        if (Object.is(updated, selected)) {
          return;
        }
        const prev = selected;
        selected = updated;
        for (const listener of selectListeners) {
          listener(selected, prev);
        }
      };

      subscribe((next) => {
        emitIfChanged(next);
      });

      return {
        get() {
          return selected;
        },
        subscribe(listener: (next: S, prev: S) => void) {
          selectListeners.add(listener);
          listener(selected, selected);
          return () => {
            selectListeners.delete(listener);
          };
        },
      };
    },
  };
}

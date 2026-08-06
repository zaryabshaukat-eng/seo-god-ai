import { h } from '../vdom.js';
import type { VNode } from '../types.js';

/** Visually hidden skip link for keyboard users (first element of `<body>`). */
export function skipLink(href = '#main', label = 'Skip to content'): VNode {
  return h('a', { class: 'skip-link', href, 'data-skip-link': true }, label);
}

/** ARIA live region announcing non-intrusive updates to assistive tech. */
export function liveRegion(message: string, id = 'live-region'): VNode {
  return h('div', { id, class: 'sr-only', role: 'status', 'aria-live': 'polite' }, message);
}

/**
 * DOM-free focus trap model. Wraps Tab/Shift+Tab around a set of `count`
 * focusable elements and supports Escape to exit.
 */
export interface FocusTrap {
  readonly count: number;
  getIndex(): number;
  focus(index: number): void;
  handleTab(forward: boolean): number;
  exit(): void;
  onKeydown(event: { key: string; shiftKey: boolean }): boolean;
}

export function createFocusTrap(count: number, options: { onExit?: () => void } = {}): FocusTrap {
  let index = -1;

  return {
    get count() {
      return count;
    },
    getIndex: () => index,
    focus(next: number) {
      index = Math.max(-1, Math.min(count - 1, next));
    },
    handleTab(forward: boolean) {
      if (count === 0) {
        return -1;
      }
      if (count === 1) {
        index = 0;
        return 0;
      }
      if (forward) {
        index = index >= count - 1 ? 0 : index + 1;
      } else {
        index = index <= 0 ? count - 1 : index - 1;
      }
      return index;
    },
    exit() {
      index = -1;
      options.onExit?.();
    },
    onKeydown(event: { key: string; shiftKey: boolean }) {
      if (event.key === 'Escape') {
        this.exit();
        return true;
      }
      if (event.key === 'Tab') {
        this.handleTab(!event.shiftKey);
        return true;
      }
      return false;
    },
  };
}

/** Roving-tabindex keyboard navigation for menus, tabs and tables. */
export interface RovingFocus {
  current(): number;
  move(delta: number): void;
  home(): void;
  end(): void;
  onKeydown(event: { key: string }): boolean;
}

export function createRovingFocus(count: number): RovingFocus {
  let index = 0;

  function wrap(next: number): number {
    if (count === 0) {
      return 0;
    }
    return ((next % count) + count) % count;
  }

  return {
    current: () => index,
    move(delta: number) {
      index = wrap(index + delta);
    },
    home() {
      index = 0;
    },
    end() {
      index = Math.max(0, count - 1);
    },
    onKeydown(event: { key: string }) {
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          this.move(1);
          return true;
        case 'ArrowUp':
        case 'ArrowLeft':
          this.move(-1);
          return true;
        case 'Home':
          this.home();
          return true;
        case 'End':
          this.end();
          return true;
        default:
          return false;
      }
    },
  };
}

/** Builds an accessible alt text from a title and context. */
export function altTextFor(title: string, context?: string): string {
  if (!context) {
    return title;
  }
  return `${title}: ${context}`;
}

/** Returns `aria-current` when a nav item matches the active path. */
export function ariaCurrent(active: boolean, value: 'page' | 'step' | 'location' | 'date' | 'time' = 'page'): string | undefined {
  return active ? value : undefined;
}

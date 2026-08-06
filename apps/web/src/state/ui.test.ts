import { describe, expect, it, vi } from 'vitest';
import { createUiStore } from './ui.js';

describe('createUiStore', () => {
  it('starts with the default chrome state', () => {
    const ui = createUiStore();
    expect(ui.getState()).toMatchObject({ sidebarOpen: true, mobileNavOpen: false, route: '/', toasts: [] });
  });

  it('opens, closes and toggles the sidebar', () => {
    const ui = createUiStore();
    ui.closeSidebar();
    expect(ui.isSidebarOpen()).toBe(false);
    ui.openSidebar();
    expect(ui.isSidebarOpen()).toBe(true);
    ui.toggleSidebar();
    expect(ui.isSidebarOpen()).toBe(false);
  });

  it('opens and closes the mobile navigation', () => {
    const ui = createUiStore();
    ui.openMobileNav();
    expect(ui.isMobileNavOpen()).toBe(true);
    ui.closeMobileNav();
    expect(ui.isMobileNavOpen()).toBe(false);
  });

  it('tracks the active route', () => {
    const ui = createUiStore();
    ui.navigate('/crawls');
    expect(ui.getRoute()).toBe('/crawls');
  });

  it('pushes and dismisses toasts', () => {
    vi.useFakeTimers();
    try {
      const ui = createUiStore();
      const id = ui.pushToast('Saved');
      expect(ui.getState().toasts).toHaveLength(1);
      expect(ui.getState().toasts[0]).toMatchObject({ id, message: 'Saved', kind: 'info', autoDismissMs: 4000 });
      ui.dismissToast(id);
      expect(ui.getState().toasts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-dismisses toasts after their duration', () => {
    vi.useFakeTimers();
    try {
      const ui = createUiStore();
      ui.pushToast('Bye', 'success', 100);
      expect(ui.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(100);
      expect(ui.getState().toasts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps toasts that opt out of auto-dismiss', () => {
    vi.useFakeTimers();
    try {
      const ui = createUiStore();
      ui.pushToast('Sticky', 'error', 0);
      vi.advanceTimersByTime(10_000);
      expect(ui.getState().toasts).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('assigns unique toast ids', () => {
    const ui = createUiStore();
    const first = ui.pushToast('a');
    const second = ui.pushToast('b');
    expect(first).not.toBe(second);
  });

  it('notifies subscribers of changes', () => {
    const ui = createUiStore();
    const listener = vi.fn();
    ui.subscribe((state) => listener(state));
    ui.navigate('/seo');
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ route: '/seo' }));
  });
});

import { describe, expect, it, vi } from 'vitest';
import { renderToString } from '../vdom.js';
import { altTextFor, ariaCurrent, createFocusTrap, createRovingFocus, liveRegion, skipLink } from './access.js';

describe('skipLink', () => {
  it('renders a visually hidden skip link', () => {
    expect(renderToString(skipLink())).toContain('class="skip-link"');
    expect(renderToString(skipLink())).toContain('href="#main"');
    expect(renderToString(skipLink('href', 'label'))).toContain('href="href"');
  });
});

describe('liveRegion', () => {
  it('renders an ARIA status region with the message', () => {
    const html = renderToString(liveRegion('Updated'));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Updated');
  });
});

describe('createFocusTrap', () => {
  it('tracks a clamped focus index', () => {
    const trap = createFocusTrap(3);
    expect(trap.count).toBe(3);
    expect(trap.getIndex()).toBe(-1);
    trap.focus(2);
    expect(trap.getIndex()).toBe(2);
    trap.focus(10);
    expect(trap.getIndex()).toBe(2);
    trap.focus(-5);
    expect(trap.getIndex()).toBe(-1);
  });

  it('wraps Tab navigation forward and backward', () => {
    const trap = createFocusTrap(3);
    trap.focus(0);
    expect(trap.handleTab(true)).toBe(1);
    expect(trap.handleTab(true)).toBe(2);
    expect(trap.handleTab(true)).toBe(0);
    expect(trap.handleTab(false)).toBe(2);
    trap.focus(2);
    expect(trap.handleTab(false)).toBe(1);
  });

  it('handles single- and zero-item traps', () => {
    const one = createFocusTrap(1);
    expect(one.handleTab(true)).toBe(0);
    const none = createFocusTrap(0);
    expect(none.handleTab(true)).toBe(-1);
    expect(none.getIndex()).toBe(-1);
  });

  it('exits and invokes the onExit callback', () => {
    const onExit = vi.fn();
    const trap = createFocusTrap(2, { onExit });
    trap.focus(1);
    expect(trap.exit()).toBeUndefined();
    expect(trap.getIndex()).toBe(-1);
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('handles keydown events for Escape and Tab', () => {
    const trap = createFocusTrap(2);
    trap.focus(0);
    expect(trap.onKeydown({ key: 'Tab', shiftKey: false })).toBe(true);
    expect(trap.getIndex()).toBe(1);
    expect(trap.onKeydown({ key: 'Escape', shiftKey: false })).toBe(true);
    expect(trap.getIndex()).toBe(-1);
    expect(trap.onKeydown({ key: 'Enter', shiftKey: false })).toBe(false);
  });
});

describe('createRovingFocus', () => {
  it('moves within bounds with wrap-around', () => {
    const focus = createRovingFocus(3);
    expect(focus.current()).toBe(0);
    focus.move(-1);
    expect(focus.current()).toBe(2);
    focus.move(2);
    expect(focus.current()).toBe(1);
  });

  it('supports home and end', () => {
    const focus = createRovingFocus(3);
    focus.move(1);
    focus.home();
    expect(focus.current()).toBe(0);
    focus.end();
    expect(focus.current()).toBe(2);
  });

  it('handles empty collections', () => {
    const focus = createRovingFocus(0);
    focus.move(3);
    expect(focus.current()).toBe(0);
    focus.end();
    expect(focus.current()).toBe(0);
  });

  it('handles arrow and home/end keydown events', () => {
    const focus = createRovingFocus(3);
    expect(focus.onKeydown({ key: 'ArrowDown' })).toBe(true);
    expect(focus.onKeydown({ key: 'ArrowRight' })).toBe(true);
    expect(focus.onKeydown({ key: 'ArrowUp' })).toBe(true);
    expect(focus.onKeydown({ key: 'ArrowLeft' })).toBe(true);
    expect(focus.current()).toBe(0);
    expect(focus.onKeydown({ key: 'Home' })).toBe(true);
    expect(focus.current()).toBe(0);
    expect(focus.onKeydown({ key: 'End' })).toBe(true);
    expect(focus.current()).toBe(2);
    expect(focus.onKeydown({ key: 'Space' })).toBe(false);
  });
});

describe('altTextFor', () => {
  it('builds accessible alt text', () => {
    expect(altTextFor('Crawls')).toBe('Crawls');
    expect(altTextFor('Crawls', 'page 2')).toBe('Crawls: page 2');
  });
});

describe('ariaCurrent', () => {
  it('returns the current marker for active items', () => {
    expect(ariaCurrent(true)).toBe('page');
    expect(ariaCurrent(true, 'step')).toBe('step');
    expect(ariaCurrent(false)).toBeUndefined();
  });
});

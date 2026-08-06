import { describe, expect, it } from 'vitest';
import {
  BREAKPOINTS,
  GUTTER_PX,
  MAX_CONTENT_WIDTH_PX,
  breakpoint,
  breakpointFor,
  columnSpan,
  columnsFor,
  matchesBreakpoint,
  responsiveClass,
} from './responsive.js';

describe('breakpoints', () => {
  it('defines a mobile-first ladder', () => {
    expect(BREAKPOINTS.map((entry) => entry.name)).toEqual(['sm', 'md', 'lg', 'xl']);
    expect(BREAKPOINTS[1]?.minWidth).toBe(768);
    expect(BREAKPOINTS[2]?.minWidth).toBe(1024);
    expect(BREAKPOINTS[3]?.minWidth).toBe(1280);
  });

  it('selects the active breakpoint by width', () => {
    expect(breakpointFor(0)).toBe('sm');
    expect(breakpointFor(767)).toBe('sm');
    expect(breakpointFor(768)).toBe('md');
    expect(breakpointFor(1023)).toBe('md');
    expect(breakpointFor(1024)).toBe('lg');
    expect(breakpointFor(1279)).toBe('lg');
    expect(breakpointFor(1280)).toBe('xl');
    expect(breakpointFor(3000)).toBe('xl');
  });

  it('returns metadata for a name with a safe default', () => {
    expect(breakpoint('lg').columns).toBe(12);
    expect(breakpoint('does-not-exist' as never)).toEqual(BREAKPOINTS[0]);
  });

  it('matches widths against a breakpoint', () => {
    expect(matchesBreakpoint(1000, 'lg')).toBe(false);
    expect(matchesBreakpoint(1024, 'lg')).toBe(true);
    expect(matchesBreakpoint(100, 'sm')).toBe(true);
  });
});

describe('columns', () => {
  it('returns the column count per breakpoint', () => {
    expect(columnsFor('sm')).toBe(4);
    expect(columnsFor('md')).toBe(8);
    expect(columnsFor('lg')).toBe(12);
    expect(columnsFor('xl')).toBe(12);
  });

  it('clamps spans to the grid', () => {
    expect(columnSpan(5, 'sm')).toBe(4);
    expect(columnSpan(1, 'sm')).toBe(1);
    expect(columnSpan(2, 'md')).toBe(2);
    expect(columnSpan(20, 'lg')).toBe(12);
  });
});

describe('responsiveClass', () => {
  it('omits the prefix for the base breakpoint', () => {
    expect(responsiveClass('grid-cols', 2, 'sm')).toBe('grid-cols:2');
  });

  it('appends the breakpoint for larger screens', () => {
    expect(responsiveClass('grid-cols', 6, 'md')).toBe('grid-cols:md:6');
  });
});

describe('layout constants', () => {
  it('exposes the gutter and max width', () => {
    expect(GUTTER_PX).toBe(16);
    expect(MAX_CONTENT_WIDTH_PX).toBe(1280);
  });
});

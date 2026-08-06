/** Responsive layout model: breakpoints, column grid and container rules. */

export type BreakpointName = 'sm' | 'md' | 'lg' | 'xl';

export interface Breakpoint {
  name: BreakpointName;
  minWidth: number;
  columns: number;
}

/** Mobile-first breakpoints with the column count of the base grid. */
export const BREAKPOINTS: readonly Breakpoint[] = [
  { name: 'sm', minWidth: 0, columns: 4 },
  { name: 'md', minWidth: 768, columns: 8 },
  { name: 'lg', minWidth: 1024, columns: 12 },
  { name: 'xl', minWidth: 1280, columns: 12 },
];

export const GUTTER_PX = 16;
export const MAX_CONTENT_WIDTH_PX = 1280;

const DEFAULT_BREAKPOINT: Breakpoint = { name: 'sm', minWidth: 0, columns: 4 };

/** Returns the largest breakpoint whose minimum width fits the given viewport width. */
export function breakpointFor(width: number): BreakpointName {
  let current: BreakpointName = 'sm';
  for (const breakpoint of BREAKPOINTS) {
    if (width >= breakpoint.minWidth) {
      current = breakpoint.name;
    } else {
      break;
    }
  }
  return current;
}

/** Returns the breakpoint metadata for a name. */
export function breakpoint(name: BreakpointName): Breakpoint {
  return BREAKPOINTS.find((entry) => entry.name === name) ?? DEFAULT_BREAKPOINT;
}

/** True when the viewport width is at least the breakpoint's minimum width. */
export function matchesBreakpoint(width: number, name: BreakpointName): boolean {
  return width >= breakpoint(name).minWidth;
}

/** Column count for a breakpoint name. */
export function columnsFor(name: BreakpointName): number {
  return breakpoint(name).columns;
}

/** CSS grid span for a column count on a given breakpoint. */
export function columnSpan(span: number, name: BreakpointName): number {
  const columns = columnsFor(name);
  return Math.max(1, Math.min(span, columns));
}

/** Tailwind-style responsive class name for a utility on a breakpoint. */
export function responsiveClass(utility: string, value: string | number, name: BreakpointName): string {
  const suffix = name === 'sm' ? '' : `:${name}`;
  return `${utility}${suffix}:${value}`;
}

import type { ThemeName } from '../types.js';

/** Semantic color tokens resolved per theme. */
export interface ThemeTokens {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  primary: string;
  primaryHover: string;
  primaryText: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  focusRing: string;
  sidebarBackground: string;
  headerBackground: string;
  codeBackground: string;
  shadow: string;
}

export const LIGHT_TOKENS: ThemeTokens = {
  background: '#f7f7f9',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  border: '#e2e2ea',
  textPrimary: '#17171c',
  textSecondary: '#5a5a66',
  primary: '#4f46e5',
  primaryHover: '#4338ca',
  primaryText: '#ffffff',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  info: '#0284c7',
  focusRing: '#4f46e5',
  sidebarBackground: '#ffffff',
  headerBackground: '#ffffff',
  codeBackground: '#f1f1f4',
  shadow: '0 1px 3px rgba(16, 16, 20, 0.08)',
};

export const DARK_TOKENS: ThemeTokens = {
  background: '#0f1115',
  surface: '#171a21',
  surfaceRaised: '#1e232c',
  border: '#2a2f3a',
  textPrimary: '#e7e9ee',
  textSecondary: '#9aa3b2',
  primary: '#818cf8',
  primaryHover: '#a5b4fc',
  primaryText: '#101321',
  success: '#4ade80',
  warning: '#fbbf24',
  danger: '#f87171',
  info: '#38bdf8',
  focusRing: '#a5b4fc',
  sidebarBackground: '#13161c',
  headerBackground: '#13161c',
  codeBackground: '#1e232c',
  shadow: '0 1px 3px rgba(0, 0, 0, 0.4)',
};

export const TOKEN_THEMES: Record<ThemeName, ThemeTokens> = {
  light: LIGHT_TOKENS,
  dark: DARK_TOKENS,
};

/** Resolves the token set for a theme. */
export function resolveTokens(theme: ThemeName): ThemeTokens {
  return TOKEN_THEMES[theme];
}

/** Serializes tokens into CSS custom properties. */
export function tokensToCss(tokens: ThemeTokens): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(tokens)) {
    lines.push(`--sg-${key}: ${value};`);
  }
  return lines.join('\n');
}

/** Relative luminance of a hex color per the WCAG 2.x formula. */
export function luminance(hex: string): number {
  const value = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) {
    return 1;
  }
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  const r = channels[0] ?? 0;
  const g = channels[1] ?? 0;
  const b = channels[2] ?? 0;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors. */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Returns the minimum contrast ratio required by WCAG for a level. */
export function requiredContrast(level: 'AA' | 'AAA', largeText: boolean): number {
  if (level === 'AAA') {
    return largeText ? 4.5 : 7;
  }
  return largeText ? 3 : 4.5;
}

/** True when the foreground/background pair meets a WCAG level. */
export function isAccessible(foreground: string, background: string, level: 'AA' | 'AAA' = 'AA', largeText = false): boolean {
  return contrastRatio(foreground, background) >= requiredContrast(level, largeText);
}

/**
 * Verifies that the most important text pairs of a token set meet WCAG AA.
 * Returns the list of failing token pair names.
 */
export function verifyAccessiblePairs(tokens: ThemeTokens): string[] {
  const failures: string[] = [];
  const pairs: Array<[string, string, string]> = [
    ['text.primary/background', tokens.textPrimary, tokens.background],
    ['text.secondary/background', tokens.textSecondary, tokens.background],
    ['text.primary/surface', tokens.textPrimary, tokens.surface],
    ['primary.text/primary', tokens.primaryText, tokens.primary],
    ['text.primary/sidebar', tokens.textPrimary, tokens.sidebarBackground],
  ];
  for (const [name, foreground, background] of pairs) {
    if (!isAccessible(foreground, background)) {
      failures.push(name);
    }
  }
  return failures;
}

/** CSS media query for the system color scheme. */
export const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

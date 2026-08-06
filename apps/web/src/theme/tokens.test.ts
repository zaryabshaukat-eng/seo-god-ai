import { describe, expect, it } from 'vitest';
import {
  DARK_TOKENS,
  LIGHT_TOKENS,
  PREFERS_DARK_QUERY,
  TOKEN_THEMES,
  contrastRatio,
  isAccessible,
  luminance,
  requiredContrast,
  resolveTokens,
  tokensToCss,
  verifyAccessiblePairs,
} from './tokens.js';

describe('tokens', () => {
  it('defines complete light and dark token sets', () => {
    const keys = [
      'background',
      'surface',
      'textPrimary',
      'textSecondary',
      'primary',
      'primaryText',
      'focusRing',
      'sidebarBackground',
    ];
    for (const key of keys) {
      expect(LIGHT_TOKENS).toHaveProperty(key);
      expect(DARK_TOKENS).toHaveProperty(key);
    }
  });

  it('resolves tokens per theme', () => {
    expect(resolveTokens('light')).toBe(LIGHT_TOKENS);
    expect(resolveTokens('dark')).toBe(DARK_TOKENS);
    expect(TOKEN_THEMES).toMatchObject({ light: LIGHT_TOKENS, dark: DARK_TOKENS });
  });

  it('serializes tokens to CSS custom properties', () => {
    const css = tokensToCss(LIGHT_TOKENS);
    expect(css).toContain('--sg-background: #f7f7f9;');
    expect(css).toContain('--sg-primary: #4f46e5;');
  });
});

describe('luminance', () => {
  it('computes relative luminance', () => {
    expect(luminance('#ffffff')).toBe(1);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ff0000')).toBeCloseTo(0.2126, 3);
  });

  it('treats invalid hex as white', () => {
    expect(luminance('#zzz')).toBe(1);
    expect(luminance('nope')).toBe(1);
  });
});

describe('contrastRatio', () => {
  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  });
});

describe('requiredContrast', () => {
  it('returns thresholds per level and text size', () => {
    expect(requiredContrast('AA', false)).toBe(4.5);
    expect(requiredContrast('AA', true)).toBe(3);
    expect(requiredContrast('AAA', false)).toBe(7);
    expect(requiredContrast('AAA', true)).toBe(4.5);
  });
});

describe('isAccessible', () => {
  it('checks WCAG AA compliance', () => {
    expect(isAccessible('#ffffff', '#000000')).toBe(true);
    expect(isAccessible('#777777', '#ffffff')).toBe(false);
    expect(isAccessible('#444444', '#ffffff')).toBe(true);
    expect(isAccessible('#444444', '#ffffff', 'AAA')).toBe(true);
  });

  it('relaxes the threshold for large text', () => {
    expect(isAccessible('#777777', '#ffffff', 'AA', true)).toBe(true);
  });
});

describe('verifyAccessiblePairs', () => {
  it('confirms the shipped token sets meet WCAG AA', () => {
    expect(verifyAccessiblePairs(LIGHT_TOKENS)).toEqual([]);
    expect(verifyAccessiblePairs(DARK_TOKENS)).toEqual([]);
  });

  it('flags failing pairs', () => {
    const failures = verifyAccessiblePairs({ ...LIGHT_TOKENS, textSecondary: '#bbbbbb' });
    expect(failures).toContain('text.secondary/background');
  });
});

describe('PREFERS_DARK_QUERY', () => {
  it('targets the system dark scheme', () => {
    expect(PREFERS_DARK_QUERY).toBe('(prefers-color-scheme: dark)');
  });
});

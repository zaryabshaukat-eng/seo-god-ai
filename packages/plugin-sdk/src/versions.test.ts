import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  isValidVersion,
  parseComparator,
  parseVersion,
  satisfies,
  type SemVer,
} from '../src/versions.js';

describe('parseVersion', () => {
  it('parses a full version', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('parses a leading-v version', () => {
    expect(parseVersion('v2.0.1')?.major).toBe(2);
  });

  it('parses prerelease and build metadata', () => {
    const version = parseVersion('1.2.3-beta.1+build.5');
    expect(version).toEqual({ major: 1, minor: 2, patch: 3, prerelease: 'beta.1', build: 'build.5' });
  });

  it('parses build metadata without prerelease', () => {
    const version = parseVersion('1.0.0+sha.abc');
    expect(version?.build).toBe('sha.abc');
    expect(version?.prerelease).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    expect(parseVersion('  1.0.0  ')?.patch).toBe(0);
  });

  it('rejects malformed versions', () => {
    for (const raw of ['', '1.2', '1.2.3.4', '1.2.3-', '1.2.3+', '1.02.3', 'a.b.c', '1.x.3', '1.2.x', '1.2.3-01', 'latest', 'v1']) {
      expect(parseVersion(raw)).toBeNull();
    }
  });

  it('rejects empty prerelease identifiers', () => {
    expect(parseVersion('1.2.3-beta..1')).toBeNull();
    expect(parseVersion('1.2.3-..beta')).toBeNull();
  });
});

describe('isValidVersion', () => {
  it('returns true for valid versions', () => {
    expect(isValidVersion('1.2.3')).toBe(true);
    expect(isValidVersion('0.0.1-alpha')).toBe(true);
  });

  it('returns false for invalid versions', () => {
    expect(isValidVersion('one.two.three')).toBe(false);
    expect(isValidVersion('')).toBe(false);
  });
});

describe('compareVersions', () => {
  const v = (raw: string): SemVer => {
    const parsed = parseVersion(raw);
    if (parsed === null) throw new Error(`bad fixture ${raw}`);
    return parsed;
  };

  it('returns 0 for equal versions', () => {
    expect(compareVersions(v('1.2.3'), v('1.2.3'))).toBe(0);
  });

  it('ignores build metadata', () => {
    expect(compareVersions(v('1.2.3'), v('1.2.3+meta'))).toBe(0);
  });

  it('orders by major, then minor, then patch', () => {
    expect(compareVersions(v('1.0.0'), v('2.0.0'))).toBe(-1);
    expect(compareVersions(v('2.0.0'), v('1.0.0'))).toBe(1);
    expect(compareVersions(v('1.1.0'), v('1.2.0'))).toBe(-1);
    expect(compareVersions(v('1.2.1'), v('1.2.2'))).toBe(-1);
    expect(compareVersions(v('1.2.2'), v('1.2.1'))).toBe(1);
  });

  it('treats prerelease as lower than the release', () => {
    expect(compareVersions(v('1.0.0-beta'), v('1.0.0'))).toBe(-1);
    expect(compareVersions(v('1.0.0'), v('1.0.0-beta'))).toBe(1);
  });

  it('orders prerelease identifiers per semver rules', () => {
    expect(compareVersions(v('1.0.0-alpha'), v('1.0.0-alpha.1'))).toBe(-1);
    expect(compareVersions(v('1.0.0-alpha.1'), v('1.0.0-alpha'))).toBe(1);
    expect(compareVersions(v('1.0.0-alpha.1'), v('1.0.0-alpha.beta'))).toBe(-1);
    expect(compareVersions(v('1.0.0-alpha.beta'), v('1.0.0-beta'))).toBe(-1);
    expect(compareVersions(v('1.0.0-beta'), v('1.0.0-beta.2'))).toBe(-1);
    expect(compareVersions(v('1.0.0-beta.2'), v('1.0.0-beta.11'))).toBe(-1);
    expect(compareVersions(v('1.0.0-1.2.3'), v('1.0.0-1.2.4'))).toBe(-1);
    expect(compareVersions(v('1.0.0-1'), v('1.0.0-alpha'))).toBe(-1);
    expect(compareVersions(v('1.0.0-alpha'), v('1.0.0-1'))).toBe(1);
    expect(compareVersions(v('1.0.0-1'), v('1.0.0-2'))).toBe(-1);
    expect(compareVersions(v('1.0.0-alpha'), v('1.0.0-alpha'))).toBe(0);
    expect(compareVersions(v('1.0.0-beta'), v('1.0.0-alpha'))).toBe(1);
  });
});

describe('parseComparator', () => {
  it('parses explicit operators', () => {
    expect(parseComparator('>=1.2.3')?.operator).toBe('>=');
    expect(parseComparator('^1.2.3')?.operator).toBe('^');
    expect(parseComparator('~1.2.3')?.operator).toBe('~');
    expect(parseComparator('<1.2.3')?.operator).toBe('<');
    expect(parseComparator('<=1.2.3')?.operator).toBe('<=');
    expect(parseComparator('>1.2.3')?.operator).toBe('>');
  });

  it('defaults the operator to =', () => {
    const comparator = parseComparator('1.2.3');
    expect(comparator?.operator).toBe('=');
    expect(comparator?.version.patch).toBe(3);
  });

  it('allows whitespace after the operator', () => {
    expect(parseComparator('>= 1.2.3')?.version.major).toBe(1);
  });

  it('rejects malformed comparators', () => {
    expect(parseComparator('')).toBeNull();
    expect(parseComparator('garbage')).toBeNull();
    expect(parseComparator('^1.2')).toBeNull();
    expect(parseComparator('>=1.x.0')).toBeNull();
    expect(parseComparator('>=1.2.3-01')).toBeNull();
  });
});

describe('satisfies', () => {
  it('matches exact versions', () => {
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.2.3', '1.2.4')).toBe(false);
  });

  it('matches caret ranges', () => {
    expect(satisfies('1.5.0', '^1.2.3')).toBe(true);
    expect(satisfies('1.2.3', '^1.2.3')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfies('1.2.2', '^1.2.3')).toBe(false);
    expect(satisfies('0.2.5', '^0.2.3')).toBe(true);
    expect(satisfies('0.3.0', '^0.2.3')).toBe(false);
    expect(satisfies('0.0.3', '^0.0.3')).toBe(true);
    expect(satisfies('0.0.4', '^0.0.3')).toBe(false);
  });

  it('matches tilde ranges', () => {
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfies('1.2.2', '~1.2.3')).toBe(false);
  });

  it('matches comparison ranges combined with AND', () => {
    expect(satisfies('1.5.0', '>=1.2.0 <2.0.0')).toBe(true);
    expect(satisfies('2.5.0', '>=1.2.0 <2.0.0')).toBe(false);
    expect(satisfies('1.0.0', '>=1.2.0 <2.0.0')).toBe(false);
  });

  it('matches <= and < upper bounds inclusively and exclusively', () => {
    expect(satisfies('1.2.0', '<=1.2.0')).toBe(true);
    expect(satisfies('1.2.1', '<=1.2.0')).toBe(false);
    expect(satisfies('1.1.9', '<=1.2.0')).toBe(true);
    expect(satisfies('1.2.0', '<1.2.0')).toBe(false);
  });

  it('ignores trailing whitespace around OR groups', () => {
    expect(satisfies('1.5.0', '>=1.0.0 ||   ')).toBe(true);
    expect(satisfies('0.5.0', '>=1.0.0 ||   ')).toBe(false);
  });

  it('matches OR groups', () => {
    expect(satisfies('0.3.0', '>=1.0.0 || <0.5.0')).toBe(true);
    expect(satisfies('1.0.0', '>=1.0.0 || <0.5.0')).toBe(true);
    expect(satisfies('0.6.0', '>=1.0.0 || <0.5.0')).toBe(false);
  });

  it('matches the wildcard and empty constraint', () => {
    expect(satisfies('9.9.9', '*')).toBe(true);
    expect(satisfies('9.9.9', '   ')).toBe(true);
  });

  it('excludes prereleases unless the range references the same triple', () => {
    expect(satisfies('1.0.0-beta', '>=1.0.0')).toBe(false);
    expect(satisfies('1.0.0-beta', '>=1.0.0-beta')).toBe(true);
    expect(satisfies('1.2.4-beta', '^1.2.4-beta')).toBe(true);
    expect(satisfies('1.2.4', '^1.2.4-beta')).toBe(true);
    expect(satisfies('2.0.0-beta', '^1.2.4-beta')).toBe(false);
  });

  it('rejects invalid inputs', () => {
    expect(satisfies('not-a-version', '>=1.0.0')).toBe(false);
    expect(satisfies('1.0.0', 'not-a-constraint')).toBe(false);
    expect(satisfies('1.0.0', '>=1.0.0 >1.5.0')).toBe(false);
    expect(satisfies('1.6.0', '>=1.0.0 >1.5.0')).toBe(true);
  });
});

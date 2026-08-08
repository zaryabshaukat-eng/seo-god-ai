/**
 * Minimal semver support for plugin versioning. Implements parsing,
 * comparison and constraint matching for the subset used by plugin manifests:
 * `*`, exact, `^`, `~`, and `>=`/`>`/`<=`/`<` comparators combined with
 * whitespace (AND) or `||` (OR). Pre-release versions only match constraints
 * that reference the same `major.minor.patch` triple, matching npm semantics.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers, e.g. `beta.1`. */
  prerelease?: string;
  /** Build metadata, ignored during comparison. */
  build?: string;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** Semver forbids leading zeros in numeric identifiers. */
function noLeadingZeros(...identifiers: string[]): boolean {
  return identifiers.every((id) => !(id.length > 1 && id[0] === '0'));
}

function identifiersValid(prerelease: string | undefined, build: string | undefined): boolean {
  for (const part of [prerelease, build]) {
    if (part === undefined) continue;
    for (const id of part.split('.')) {
      if (id.length === 0) return false;
      if (/^\d+$/.test(id) && !noLeadingZeros(id)) return false;
    }
  }
  return true;
}

/** Parses a semver string into its components, or `null` when invalid. */
export function parseVersion(raw: string): SemVer | null {
  const match = VERSION_PATTERN.exec(raw.trim());
  if (match === null) return null;
  const major = match[1] as string;
  const minor = match[2] as string;
  const patch = match[3] as string;
  if (!noLeadingZeros(major, minor, patch)) return null;
  if (!identifiersValid(match[4], match[5])) return null;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    ...(match[4] === undefined ? {} : { prerelease: match[4] }),
    ...(match[5] === undefined ? {} : { build: match[5] }),
  };
}

/** True when `raw` is a valid semantic version. */
export function isValidVersion(raw: string): boolean {
  return parseVersion(raw) !== null;
}

function prereleaseTokens(prerelease?: string): string[] {
  return prerelease === undefined ? [] : prerelease.split('.');
}

/** Compares two pre-release identifier lists; a list beats no list. */
function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftIsNumeric = /^\d+$/.test(left);
    const rightIsNumeric = /^\d+$/.test(right);
    if (leftIsNumeric && rightIsNumeric) {
      const numeric = Number(left) - Number(right);
      if (numeric !== 0) return numeric < 0 ? -1 : 1;
    } else if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1;
    } else {
      const comparison = left < right ? -1 : left > right ? 1 : 0;
      if (comparison !== 0) return comparison;
    }
  }
  return 0;
}

/** Compares two parsed versions. Returns `-1`, `0` or `1`. */
export function compareVersions(a: SemVer, b: SemVer): number {
  const major = a.major - b.major;
  if (major !== 0) return major < 0 ? -1 : 1;
  const minor = a.minor - b.minor;
  if (minor !== 0) return minor < 0 ? -1 : 1;
  const patch = a.patch - b.patch;
  if (patch !== 0) return patch < 0 ? -1 : 1;
  return comparePrerelease(prereleaseTokens(a.prerelease), prereleaseTokens(b.prerelease));
}

export type ComparatorOperator = '=' | '>=' | '<=' | '>' | '<' | '^' | '~';

export interface Comparator {
  operator: ComparatorOperator;
  version: SemVer;
}

const COMPARATOR_PATTERN = /^(\^|~|>=|<=|>|<|=)?\s*(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/;

/** Parses a single comparator like `>=1.2.3-beta`; returns `null` when invalid. */
export function parseComparator(raw: string): Comparator | null {
  const match = COMPARATOR_PATTERN.exec(raw.trim());
  if (match === null) return null;
  const version = parseVersion(match[2] ?? '');
  if (version === null) return null;
  const operator = (match[1] ?? '=') as ComparatorOperator;
  return { operator, version };
}

interface ComparatorBounds {
  lower: SemVer | null;
  upper: SemVer | null;
  lowerExclusive: boolean;
  upperExclusive: boolean;
}

function comparatorBounds(comparator: Comparator): ComparatorBounds {
  const { operator, version } = comparator;
  if (operator === '^') {
    if (version.major > 0) {
      return { lower: version, upper: { major: version.major + 1, minor: 0, patch: 0 }, lowerExclusive: false, upperExclusive: true };
    }
    if (version.minor > 0) {
      return { lower: version, upper: { major: 0, minor: version.minor + 1, patch: 0 }, lowerExclusive: false, upperExclusive: true };
    }
    return { lower: version, upper: { major: 0, minor: 0, patch: version.patch + 1 }, lowerExclusive: false, upperExclusive: true };
  }
  if (operator === '~') {
    return { lower: version, upper: { major: version.major, minor: version.minor + 1, patch: 0 }, lowerExclusive: false, upperExclusive: true };
  }
  if (operator === '>=') return { lower: version, upper: null, lowerExclusive: false, upperExclusive: true };
  if (operator === '>') return { lower: version, upper: null, lowerExclusive: true, upperExclusive: true };
  if (operator === '<=') return { lower: null, upper: version, lowerExclusive: false, upperExclusive: false };
  if (operator === '<') return { lower: null, upper: version, lowerExclusive: false, upperExclusive: true };
  return { lower: version, upper: version, lowerExclusive: false, upperExclusive: false };
}

/** Splits a constraint into `||`-separated ranges of comparators. */
function rangesOf(constraint: string): Comparator[][] {
  const groups: Comparator[][] = [];
  for (const group of constraint.split('||')) {
    const comparators: Comparator[] = [];
    for (const part of group.trim().split(/\s+/)) {
      if (part.length === 0) continue;
      const comparator = parseComparator(part);
      if (comparator !== null) comparators.push(comparator);
    }
    groups.push(comparators);
  }
  return groups;
}

function prereleaseExcluded(version: SemVer, comparators: Comparator[]): boolean {
  if (version.prerelease === undefined) return false;
  return !comparators.some((comparator) => sameTriple(comparator.version, version));
}

function sameTriple(a: SemVer, b: SemVer): boolean {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch;
}

/**
 * True when `version` satisfies `constraint`. Empty or `*` constraints match
 * everything. Supports `||` (OR) groups and whitespace-separated ANDs.
 */
export function satisfies(version: string, constraint: string): boolean {
  const parsed = parseVersion(version);
  if (parsed === null) return false;
  const trimmed = constraint.trim();
  if (trimmed.length === 0 || trimmed === '*') return true;

  for (const comparators of rangesOf(trimmed)) {
    if (comparators.length === 0) continue;
    if (prereleaseExcluded(parsed, comparators)) continue;
    const inRange = comparators.every((comparator) => {
      const { lower, upper, lowerExclusive, upperExclusive } = comparatorBounds(comparator);
      if (lower !== null) {
        const cmp = compareVersions(parsed, lower);
        if (lowerExclusive ? cmp <= 0 : cmp < 0) return false;
      }
      if (upper !== null) {
        const cmp = compareVersions(parsed, upper);
        if (upperExclusive ? cmp >= 0 : cmp > 0) return false;
      }
      return true;
    });
    if (inRange) return true;
  }
  return false;
}

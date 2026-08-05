/**
 * Cron expression parsing and next-fire computation.
 *
 * Supports the standard 5-field form (`minute hour day-of-month month
 * day-of-week`) plus an optional leading seconds field. Fields accept `*`,
 * `?`, single values, `a-b` ranges, and steps (`*`/n, `a-b`/n) plus comma
 * lists. Month and day names (`JAN`..`DEC`, `SUN`..`SAT`) are accepted.
 *
 * Day-of-month / day-of-week follow the standard Vixie-cron rule: when both
 * are restricted the date matches if *either* matches; when only one is
 * restricted that one is authoritative. Expressions evaluate in the
 * scheduler's local timezone.
 */

import { CronValidationError } from './errors.js';

export const CRON_MAX_SEARCH_YEARS = 5;

const MONTH_NAMES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const DAY_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

interface ParsedField {
  values: Set<number>;
  wildcard: boolean;
}

function fullRange(min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (let value = min; value <= max; value += 1) values.add(value);
  return values;
}

function parseValue(raw: string, names?: Record<string, number>): number {
  if (names !== undefined) {
    const named = names[raw.toUpperCase()];
    if (named !== undefined) return named;
  }
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new CronValidationError(`"${raw}" is not a valid cron value`);
  }
  return value;
}

function parseField(
  spec: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): ParsedField {
  const values = new Set<number>();
  let wildcard = false;
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '' ) {
      throw new CronValidationError(`empty cron field element in "${spec}"`);
    }
    if (trimmed === '*' || trimmed === '?') {
      wildcard = true;
      for (const value of fullRange(min, max)) values.add(value);
      continue;
    }

    let base = trimmed;
    let step = 1;
    const stepIndex = trimmed.lastIndexOf('/');
    if (stepIndex !== -1) {
      base = trimmed.slice(0, stepIndex);
      const stepRaw = trimmed.slice(stepIndex + 1);
      const stepParsed = Number.parseInt(stepRaw, 10);
      if (Number.isNaN(stepParsed) || stepParsed < 1) {
        throw new CronValidationError(`step in "${trimmed}" must be a positive integer`);
      }
      step = stepParsed;
    }

    let start: number;
    let end: number;
    if (base === '*') {
      start = min;
      end = max;
    } else {
      const range = base.split('-');
      if (range.length === 1) {
        start = parseValue(range[0]!, names);
        end = start;
      } else if (range.length === 2) {
        start = parseValue(range[0]!, names);
        end = parseValue(range[1]!, names);
      } else {
        throw new CronValidationError(`invalid cron range "${trimmed}"`);
      }
    }
    if (start < min || end > max || start > end) {
      throw new CronValidationError(
        `cron value ${start}-${end} out of range ${min}-${max} in "${spec}"`,
      );
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return { values, wildcard };
}

/**
 * A parsed cron expression. Immutable; the only operation is computing the
 * next fire time strictly after a given date.
 */
export class CronExpression {
  readonly expression: string;
  readonly hasSeconds: boolean;
  readonly seconds: Set<number> | null;
  readonly minutes: Set<number>;
  readonly hours: Set<number>;
  readonly daysOfMonth: Set<number>;
  readonly months: Set<number>;
  readonly daysOfWeek: Set<number>;
  private readonly domWildcard: boolean;
  private readonly dowWildcard: boolean;

  constructor(
    expression: string,
    seconds: Set<number> | null,
    minutes: Set<number>,
    hours: Set<number>,
    daysOfMonth: Set<number>,
    months: Set<number>,
    daysOfWeek: Set<number>,
    domWildcard: boolean,
    dowWildcard: boolean,
  ) {
    this.expression = expression;
    this.seconds = seconds;
    this.minutes = minutes;
    this.hours = hours;
    this.daysOfMonth = daysOfMonth;
    this.months = months;
    this.daysOfWeek = daysOfWeek;
    this.domWildcard = domWildcard;
    this.dowWildcard = dowWildcard;
    this.hasSeconds = seconds !== null;
  }

  /**
   * Returns the next fire time strictly after `after`, or `null` when no
   * occurrence exists within the search horizon.
   */
  nextAfter(after: Date): Date | null {
    let candidate = new Date(after.getTime());
    candidate.setMilliseconds(0);
    if (this.hasSeconds) {
      candidate.setTime(candidate.getTime() + 1000);
    } else {
      candidate.setSeconds(0, 0);
      candidate.setTime(candidate.getTime() + 60_000);
    }

    const maxYear = after.getFullYear() + CRON_MAX_SEARCH_YEARS;
    for (;;) {
      const year = candidate.getFullYear();
      if (year > maxYear) return null;
      const month = candidate.getMonth() + 1;
      const monthIndex = month - 1;
      const day = candidate.getDate();

      if (!this.months.has(month)) {
        candidate = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);
        continue;
      }
      if (!this.matchesDomDow(candidate)) {
        candidate = new Date(year, monthIndex, day + 1, 0, 0, 0, 0);
        continue;
      }

      const hour = candidate.getHours();
      if (!this.hours.has(hour)) {
        const nextHour = this.firstMatch(this.hours, hour + 1, 23);
        if (nextHour === null) {
          candidate = new Date(year, monthIndex, day + 1, 0, 0, 0, 0);
          continue;
        }
        candidate = new Date(year, monthIndex, day, nextHour, 0, 0, 0);
        continue;
      }

      const minute = candidate.getMinutes();
      if (!this.minutes.has(minute)) {
        const nextMinute = this.firstMatch(this.minutes, minute + 1, 59);
        if (nextMinute === null) {
          candidate = new Date(year, monthIndex, day, hour + 1, 0, 0, 0);
          continue;
        }
        candidate = new Date(year, monthIndex, day, hour, nextMinute, 0, 0);
        continue;
      }

      if (this.seconds !== null) {
        const second = candidate.getSeconds();
        const nextSecond = this.firstMatch(this.seconds, second, 59);
        if (nextSecond === null) {
          candidate = new Date(year, monthIndex, day, hour, minute + 1, 0, 0);
          continue;
        }
        return new Date(year, monthIndex, day, hour, minute, nextSecond, 0);
      }

      return new Date(year, monthIndex, day, hour, minute, 0, 0);
    }
  }

  private firstMatch(values: Set<number>, from: number, to: number): number | null {
    for (let value = from; value <= to; value += 1) {
      if (values.has(value)) return value;
    }
    return null;
  }

  private matchesDomDow(date: Date): boolean {
    const domMatch = this.domWildcard || this.daysOfMonth.has(date.getDate());
    const dowMatch = this.dowWildcard || this.daysOfWeek.has(date.getDay());
    if (this.domWildcard && this.dowWildcard) return true;
    if (!this.domWildcard && !this.dowWildcard) return domMatch || dowMatch;
    return this.domWildcard ? dowMatch : domMatch;
  }
}

function normalizeDayOfWeek(values: Set<number>): Set<number> {
  const normalized = new Set<number>();
  for (const value of values) normalized.add(value % 7);
  return normalized;
}

/**
 * Parses a cron expression into an immutable {@link CronExpression}. Throws
 * a {@link CronValidationError} when the expression is malformed.
 */
export function parseCron(expression: string): CronExpression {
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new CronValidationError('cron expression must be a non-empty string');
  }
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    throw new CronValidationError(
      `cron expression must have 5 or 6 fields, got ${fields.length}: "${expression}"`,
    );
  }

  let seconds: Set<number> | null = null;
  let offset = 0;
  if (fields.length === 6) {
    seconds = parseField(fields[0]!, 0, 59).values;
    offset = 1;
  }
  const minutes = parseField(fields[offset]!, 0, 59).values;
  const hours = parseField(fields[offset + 1]!, 0, 23).values;
  const dom = parseField(fields[offset + 2]!, 1, 31);
  const months = parseField(fields[offset + 3]!, 1, 12, MONTH_NAMES).values;
  const dow = parseField(fields[offset + 4]!, 0, 7, DAY_NAMES);

  return new CronExpression(
    expression,
    seconds,
    minutes,
    hours,
    dom.values,
    months,
    normalizeDayOfWeek(dow.values),
    dom.wildcard,
    dow.wildcard,
  );
}

/** Returns `true` when the expression is a valid cron expression. */
export function isCronValid(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

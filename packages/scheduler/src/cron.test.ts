import { describe, expect, it } from 'vitest';
import { CronValidationError } from './errors.js';
import { CronExpression, isCronValid, parseCron } from './cron.js';

function local(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(year, month - 1, day, hour, minute, second, 0);
}

describe('parseCron', () => {
  it('parses the every-minute expression', () => {
    const cron = parseCron('* * * * *');
    expect(cron.expression).toBe('* * * * *');
    expect(cron.hasSeconds).toBe(false);
    expect(cron.minutes.size).toBe(60);
    expect(cron.hours.size).toBe(24);
    expect(cron.daysOfMonth.size).toBe(31);
    expect(cron.months.size).toBe(12);
    expect(cron.daysOfWeek.size).toBe(7);
  });

  it('parses a 6-field expression with seconds', () => {
    const cron = parseCron('30 0 9 * * *');
    expect(cron.hasSeconds).toBe(true);
    expect(cron.seconds).not.toBeNull();
    expect(cron.seconds?.has(30)).toBe(true);
    expect(cron.minutes.has(0)).toBe(true);
    expect(cron.hours.has(9)).toBe(true);
  });

  it('accepts month and day names', () => {
    const cron = parseCron('0 0 1 JAN MON');
    expect(cron.months.has(1)).toBe(true);
    expect(cron.daysOfWeek.has(1)).toBe(true);
  });

  it('normalizes sunday day-of-week 7 to 0', () => {
    const cron = parseCron('0 0 * * 7');
    expect(cron.daysOfWeek.has(0)).toBe(true);
    expect(cron.daysOfWeek.has(7)).toBe(false);
  });

  it('treats ? as a wildcard', () => {
    const cron = parseCron('0 0 ? * ?');
    expect(cron.daysOfMonth.size).toBe(31);
    expect(cron.daysOfWeek.size).toBe(7);
  });

  it('supports lists, ranges, steps and mixed expressions', () => {
    const cron = parseCron('0,30 9-17/2 1-15 * 1-5');
    expect(cron.minutes.has(0)).toBe(true);
    expect(cron.minutes.has(30)).toBe(true);
    expect(cron.hours.has(9)).toBe(true);
    expect(cron.hours.has(11)).toBe(true);
    expect(cron.hours.has(17)).toBe(true);
    expect(cron.daysOfMonth.has(1)).toBe(true);
    expect(cron.daysOfMonth.has(15)).toBe(true);
    expect(cron.daysOfWeek.has(0)).toBe(false);
    expect(cron.daysOfWeek.has(1)).toBe(true);
    expect(cron.daysOfWeek.has(5)).toBe(true);
  });

  it('rejects an empty expression', () => {
    expect(() => parseCron('')).toThrow(CronValidationError);
    expect(() => parseCron('   ')).toThrow(CronValidationError);
  });

  it('rejects a wrong field count', () => {
    expect(() => parseCron('* * * *')).toThrow(/must have 5 or 6 fields/);
    expect(() => parseCron('* * * * * * *')).toThrow(/must have 5 or 6 fields/);
  });

  it.each([
    '60 * * * *',
    '* 24 * * *',
    '* * 0 * *',
    '* * 32 * *',
    '* * * 0 *',
    '* * * 13 *',
    '* * * * 8',
    '* * * * BAD',
    '* * * FOO *',
  ])('rejects out-of-range or unknown value in "%s"', (expression) => {
    expect(() => parseCron(expression)).toThrow(CronValidationError);
  });

  it('rejects a reversed range', () => {
    expect(() => parseCron('10-5 * * * *')).toThrow(/out of range/);
  });

  it('rejects an invalid step', () => {
    expect(() => parseCron('*/0 * * * *')).toThrow(/positive integer/);
    expect(() => parseCron('*/x * * * *')).toThrow(/positive integer/);
  });

  it('rejects an empty list element', () => {
    expect(() => parseCron('1,,2 * * * *')).toThrow(/empty cron field element/);
  });

  it('rejects a malformed range', () => {
    expect(() => parseCron('1-2-3 * * * *')).toThrow(/invalid cron range/);
  });
});

describe('isCronValid', () => {
  it('returns true for valid expressions', () => {
    expect(isCronValid('0 0 * * *')).toBe(true);
    expect(isCronValid('*/5 * * * *')).toBe(true);
  });

  it('returns false for invalid expressions', () => {
    expect(isCronValid('')).toBe(false);
    expect(isCronValid('60 * * * *')).toBe(false);
    expect(isCronValid('* * * *')).toBe(false);
  });
});

describe('CronExpression.nextAfter', () => {
  it('returns the next minute for every-minute cron', () => {
    const cron = parseCron('* * * * *');
    const next = cron.nextAfter(local(2026, 1, 5, 10, 30, 0));
    expect(next).toEqual(local(2026, 1, 5, 10, 31, 0));
  });

  it('advances to the next matching minute', () => {
    const cron = parseCron('30 * * * *');
    expect(cron.nextAfter(local(2026, 1, 5, 10, 31, 0))).toEqual(local(2026, 1, 5, 11, 30, 0));
  });

  it('is strictly after the given instant', () => {
    const cron = parseCron('* * * * *');
    expect(cron.nextAfter(local(2026, 1, 5, 10, 31, 45))).toEqual(local(2026, 1, 5, 10, 32, 0));
  });

  it('advances to the next matching hour', () => {
    const cron = parseCron('0 6 * * *');
    expect(cron.nextAfter(local(2026, 1, 5, 5, 30, 0))).toEqual(local(2026, 1, 5, 6, 0, 0));
    expect(cron.nextAfter(local(2026, 1, 5, 6, 30, 0))).toEqual(local(2026, 1, 6, 6, 0, 0));
  });

  it('advances across month boundaries', () => {
    const cron = parseCron('0 0 1 2 *');
    expect(cron.nextAfter(local(2026, 2, 1, 12, 0, 0))).toEqual(local(2027, 2, 1, 0, 0, 0));
  });

  it('matches a restricted day-of-month when day-of-week is wildcard', () => {
    const cron = parseCron('0 0 13 * *');
    expect(cron.nextAfter(local(2026, 1, 1, 0, 0, 0))).toEqual(local(2026, 1, 13, 0, 0, 0));
  });

  it('matches a restricted day-of-week when day-of-month is wildcard', () => {
    const cron = parseCron('0 0 * * MON');
    expect(cron.nextAfter(local(2026, 1, 1, 0, 0, 0))).toEqual(local(2026, 1, 5, 0, 0, 0));
  });

  it('matches either day-of-month or day-of-week when both are restricted', () => {
    const cron = parseCron('0 0 13 1 FRI');
    // Jan 2 2026 is a Friday and precedes Jan 13.
    expect(cron.nextAfter(local(2026, 1, 1, 0, 0, 0))).toEqual(local(2026, 1, 2, 0, 0, 0));
  });

  it('supports range and list minutes', () => {
    const every15 = parseCron('*/15 * * * *');
    expect(every15.nextAfter(local(2026, 1, 5, 10, 7, 0))).toEqual(local(2026, 1, 5, 10, 15, 0));
    const early = parseCron('0-10 * * * *');
    expect(early.nextAfter(local(2026, 1, 5, 10, 11, 0))).toEqual(local(2026, 1, 5, 11, 0, 0));
    const fiveToFifteen = parseCron('5-15/5 * * * *');
    expect(fiveToFifteen.nextAfter(local(2026, 1, 5, 10, 6, 0))).toEqual(local(2026, 1, 5, 10, 10, 0));
  });

  it('honors the seconds field', () => {
    const every5Seconds = parseCron('*/5 * * * * *');
    expect(every5Seconds.nextAfter(local(2026, 1, 5, 10, 0, 1))).toEqual(local(2026, 1, 5, 10, 0, 5));
    const at30 = parseCron('30 * * * * *');
    expect(at30.nextAfter(local(2026, 1, 5, 10, 0, 30))).toEqual(local(2026, 1, 5, 10, 1, 30));
  });

  it('finds a leap-day schedule within the search horizon', () => {
    const cron = parseCron('0 0 29 2 *');
    expect(cron.nextAfter(local(2026, 1, 1, 0, 0, 0))).toEqual(local(2028, 2, 29, 0, 0, 0));
  });

  it('returns null when a schedule can never fire', () => {
    const cron = parseCron('0 0 31 2 *');
    expect(cron.nextAfter(local(2026, 1, 1, 0, 0, 0))).toBeNull();
    // A February 30 never exists either.
    expect(parseCron('0 0 30 2 *').nextAfter(local(2026, 1, 1, 0, 0, 0))).toBeNull();
  });

  it('keeps finding occurrences of a firing schedule for years', () => {
    const cron = parseCron('0 0 1 1 *');
    expect(cron.nextAfter(local(2032, 6, 1, 0, 0, 0))).toEqual(local(2033, 1, 1, 0, 0, 0));
  });
});

describe('CronExpression construction', () => {
  it('exposes the parsed fields', () => {
    const cron = new CronExpression(
      'custom',
      new Set([10]),
      new Set([0]),
      new Set([12]),
      new Set([1]),
      new Set([1]),
      new Set([1]),
      false,
      false,
    );
    expect(cron.hasSeconds).toBe(true);
    expect(cron.seconds?.has(10)).toBe(true);
    expect(cron.nextAfter(local(2026, 2, 1, 12, 0, 0))).toEqual(local(2027, 1, 1, 12, 0, 10));
  });
});

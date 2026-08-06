/**
 * Reporting utilities: date/period arithmetic over inclusive `YYYY-MM-DD`
 * strings, numeric helpers and id generation. All date math runs on UTC to
 * stay DST-independent and deterministic for tests.
 */

export interface ReportPeriod {
  startDate: string;
  endDate: string;
}

export interface ReportPeriodOptions {
  startDate?: string;
  endDate?: string;
  days?: number;
  compare?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Clamps a number into a range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Round to a fixed number of decimals. */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** `numerator / denominator` or `null` when the denominator is zero. */
export function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

/** Percentage change between two values, `null` when not computable. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Formats a `Date` as a local `YYYY-MM-DD` string. */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Adds days to a `YYYY-MM-DD` date (UTC math). */
export function addDays(date: string, days: number): string {
  const parts = date.split('-').map((part) => Number(part));
  const year = Number(parts[0]);
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const utc = Date.UTC(year, month - 1, day) + days * 86_400_000;
  return new Date(utc).toISOString().slice(0, 10);
}

/** Number of days between two `YYYY-MM-DD` dates (inclusive start, exclusive end). */
export function daysBetween(startDate: string, endDate: string): number {
  const start = partsToUtc(startDate);
  const end = partsToUtc(endDate);
  return Math.round((end - start) / 86_400_000);
}

function partsToUtc(value: string): number {
  const parts = value.split('-').map((part) => Number(part));
  return Date.UTC(Number(parts[0]), (parts[1] ?? 1) - 1, parts[2] ?? 1);
}

/** Days in a `YYYY-MM-DD` period (inclusive). */
export function daysIn(period: ReportPeriod): number {
  return daysBetween(period.startDate, period.endDate) + 1;
}

/** Every `YYYY-MM-DD` in a period, ascending, inclusive. */
export function fillDateRange(startDate: string, endDate: string): string[] {
  const count = daysBetween(startDate, endDate);
  if (count < 0) return [];
  const dates: string[] = [];
  for (let offset = 0; offset <= count; offset += 1) {
    dates.push(addDays(startDate, offset));
  }
  return dates;
}

/** Resolves a period from options (defaults to the last `days` days ending today). */
export function periodFor(options: ReportPeriodOptions, now: () => Date): ReportPeriod {
  const endDate = options.endDate ?? toIsoDate(now());
  if (options.startDate !== undefined) {
    return { startDate: options.startDate, endDate };
  }
  const days = Math.max(1, options.days ?? 30);
  return { startDate: addDays(endDate, -(days - 1)), endDate };
}

/** The period of the same length immediately before a period. */
export function previousPeriod(period: ReportPeriod): ReportPeriod {
  const length = daysIn(period);
  const startDate = addDays(period.startDate, -length);
  return { startDate, endDate: addDays(period.startDate, -1) };
}

/** Date part of an ISO timestamp or date string. */
export function datePart(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/** True when an ISO timestamp/date falls inside an inclusive period. */
export function inPeriod(value: string, period: ReportPeriod): boolean {
  const date = datePart(value);
  return date >= period.startDate && date <= period.endDate;
}

/** Percentile (nearest-rank) over a list of numbers; 0 for empty input. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

/** Stable-ish id: `rep_<seed>_<ts36>_<rand>`. */
export function newReportId(seed: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `rep_${seed}_${timestamp}_${random}`;
}

/** Normalizes any value to a finite number or `null`. */
export function toFinite(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** True when a string is a valid `YYYY-MM-DD` date. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parts = value.split('-').map((part) => Number(part));
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Scheduled reports: a light-weight, dependency-free scheduler for cron-like
 * expressions (`minute hour * * *`, with optional `minute,hour` lists). It
 * tracks definitions in memory and invokes a handler for every definition due
 * at a given time. The handler is injected (see `ReportEngineService`) so the
 * scheduler stays transport-agnostic.
 */

import { ReportScheduleError } from './errors.js';
import type { ReportFormat, ReportKind } from './types.js';
import { isIsoDate } from './utils.js';

const REPORT_FORMATS: readonly ReportFormat[] = ['json', 'pdf', 'csv'];
const REPORT_KINDS: readonly ReportKind[] = ['executive-dashboard', 'seo', 'kpi', 'trends', 'alerts'];

export interface ScheduledReportDefinition {
  id?: string;
  storeId?: string;
  kind: ReportKind;
  cron: string;
  format: ReportFormat;
  recipients: string[];
  enabled: boolean;
  lastRun?: string | null;
}

export interface ScheduledReportRecord {
  id: string;
  storeId?: string;
  kind: ReportKind;
  cron: string;
  format: ReportFormat;
  recipients: string[];
  enabled: boolean;
  lastRun: string | null;
}

export type ScheduleRunHandler = (definition: ScheduledReportRecord, now: Date) => Promise<void>;

function nextId(): string {
  return `schd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function validateCron(cron: string): boolean {
  const fields = cron.split(/\s+/).filter(Boolean);
  if (fields.length < 5 || fields.length > 6) return false;
  const minute = fields[0]!;
  const hour = fields[1]!;
  if (minute !== '*') {
    for (const value of minute.split(',')) {
      if (!/^\d+$/.test(value) || Number(value) < 0 || Number(value) > 59) return false;
    }
  }
  if (hour !== '*') {
    for (const value of hour.split(',')) {
      if (!/^\d+$/.test(value) || Number(value) < 0 || Number(value) > 23) return false;
    }
  }
  return true;
}

/**
 * In-memory scheduler for report definitions. `runDue(now)` invokes the
 * handler for every enabled definition whose minute/hour match and that has
 * not already run in the same minute.
 */
export class ReportScheduler {
  private readonly definitions: ScheduledReportRecord[] = [];

  constructor(
    definitions: readonly ScheduledReportDefinition[] = [],
    private readonly onRun: ScheduleRunHandler | null = null,
  ) {
    for (const definition of definitions) {
      this.add(definition);
    }
  }

  /** Adds a definition (duplicate explicit ids are rejected). */
  add(definition: ScheduledReportDefinition): ScheduledReportRecord {
    if (definition.id !== undefined && this.definitions.some((record) => record.id === definition.id)) {
      throw new ReportScheduleError(`Scheduled report '${definition.id}' already exists.`, {
        scheduleId: definition.id,
      });
    }
    if (!REPORT_KINDS.includes(definition.kind)) {
      throw new ReportScheduleError(`Invalid report kind '${definition.kind}'.`, { scheduleId: definition.id });
    }
    if (!REPORT_FORMATS.includes(definition.format)) {
      throw new ReportScheduleError(`Invalid report format '${definition.format}'.`, { scheduleId: definition.id });
    }
    if (!validateCron(definition.cron)) {
      throw new ReportScheduleError(
        `Invalid cron expression '${definition.cron}'; expected 'minute hour * * *'.`,
        { scheduleId: definition.id },
      );
    }
    const record: ScheduledReportRecord = {
      id: definition.id ?? nextId(),
      storeId: definition.storeId,
      kind: definition.kind,
      cron: definition.cron,
      format: definition.format,
      recipients: definition.recipients.slice(),
      enabled: definition.enabled,
      lastRun: definition.lastRun ?? null,
    };
    this.definitions.push(record);
    return record;
  }

  /** Immutable list of definitions. */
  list(): ScheduledReportRecord[] {
    return this.definitions.map((record) => ({ ...record, recipients: record.recipients.slice() }));
  }

  get(id: string): ScheduledReportRecord | null {
    const record = this.definitions.find((definition) => definition.id === id);
    return record === undefined ? null : { ...record, recipients: record.recipients.slice() };
  }

  remove(id: string): boolean {
    const index = this.definitions.findIndex((definition) => definition.id === id);
    if (index < 0) return false;
    this.definitions.splice(index, 1);
    return true;
  }

  /** True when a definition's cron matches `now` and it hasn't run this minute. */
  isDue(definition: ScheduledReportRecord, now: Date): boolean {
    if (!definition.enabled) return false;
    const fields = definition.cron.split(/\s+/).filter(Boolean);
    const minute = fields[0]!;
    const hour = fields[1]!;
    const matchesMinute = minute === '*' || minute.split(',').includes(String(now.getUTCMinutes()));
    const matchesHour = hour === '*' || hour.split(',').includes(String(now.getUTCHours()));
    if (!matchesMinute || !matchesHour) return false;
    if (definition.lastRun !== null && isIsoDate(definition.lastRun.slice(0, 10))) {
      const last = new Date(definition.lastRun);
      if (
        last.getUTCFullYear() === now.getUTCFullYear() &&
        last.getUTCMonth() === now.getUTCMonth() &&
        last.getUTCDate() === now.getUTCDate() &&
        last.getUTCHours() === now.getUTCHours() &&
        last.getUTCMinutes() === now.getUTCMinutes()
      ) {
        return false;
      }
    }
    return true;
  }

  /** Runs the handler for every due definition and bumps `lastRun`. */
  async runDue(now: Date = new Date()): Promise<ScheduledReportRecord[]> {
    const due = this.definitions.filter((definition) => this.isDue(definition, now));
    for (const definition of due) {
      if (this.onRun === null) {
        throw new ReportScheduleError(`No handler registered for scheduled report '${definition.id}'.`, {
          scheduleId: definition.id,
        });
      }
      try {
        await this.onRun(definition, now);
      } catch (error) {
        throw new ReportScheduleError(
          `Scheduled report '${definition.id}' failed: ${error instanceof Error ? error.message : String(error)}`,
          { scheduleId: definition.id },
          error,
        );
      }
      definition.lastRun = now.toISOString();
    }
    return due.map((definition) => ({ ...definition, recipients: definition.recipients.slice() }));
  }
}

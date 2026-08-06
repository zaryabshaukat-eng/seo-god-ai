import { describe, expect, it, vi } from 'vitest';
import { ReportScheduleError } from './errors.js';
import { ReportScheduler, type ScheduledReportDefinition } from './scheduler.js';

const definition: ScheduledReportDefinition = {
  kind: 'executive-dashboard',
  cron: '30 10 * * *',
  format: 'pdf',
  recipients: ['ops@example.com'],
  enabled: true,
};

describe('ReportScheduler.add', () => {
  it('adds a definition and generates an id', () => {
    const scheduler = new ReportScheduler();
    const record = scheduler.add(definition);
    expect(record.id).toMatch(/^schd_/);
    expect(record.format).toBe('pdf');
    expect(record.enabled).toBe(true);
    expect(record.lastRun).toBeNull();
    expect(record.recipients).toEqual(['ops@example.com']);
  });

  it('preserves an explicit id and rejects duplicates', () => {
    const scheduler = new ReportScheduler();
    scheduler.add({ ...definition, id: 's-1' });
    expect(() => scheduler.add({ ...definition, id: 's-1' })).toThrow(ReportScheduleError);
  });

  it('rejects unknown kinds, formats and invalid cron', () => {
    const scheduler = new ReportScheduler();
    expect(() => scheduler.add({ ...definition, kind: 'bogus' as never })).toThrow(/Invalid report kind/);
    expect(() => scheduler.add({ ...definition, format: 'xls' as never })).toThrow(/Invalid report format/);
    expect(() => scheduler.add({ ...definition, cron: '* * *' })).toThrow(/Invalid cron/);
    expect(() => scheduler.add({ ...definition, cron: '99 10 * * *' })).toThrow(/Invalid cron/);
    expect(() => scheduler.add({ ...definition, cron: '* 25 * * *' })).toThrow(/Invalid cron/);
  });

  it('seeds from constructor definitions', () => {
    const scheduler = new ReportScheduler([{ ...definition, id: 's-1' }]);
    expect(scheduler.list()).toHaveLength(1);
  });
});

describe('ReportScheduler list/get/remove', () => {
  it('lists immutable copies and looks up by id', () => {
    const scheduler = new ReportScheduler();
    const record = scheduler.add({ ...definition, id: 's-1' });
    expect(scheduler.list()).toHaveLength(1);
    expect(scheduler.get('s-1')).toEqual(record);
    expect(scheduler.get('missing')).toBeNull();
  });

  it('removes by id', () => {
    const scheduler = new ReportScheduler();
    scheduler.add({ ...definition, id: 's-1' });
    expect(scheduler.remove('s-1')).toBe(true);
    expect(scheduler.remove('s-1')).toBe(false);
    expect(scheduler.list()).toEqual([]);
  });
});

describe('ReportScheduler.isDue', () => {
  const now = new Date('2024-01-08T10:30:00.000Z');

  it('matches minute and hour with wildcards', () => {
    const scheduler = new ReportScheduler();
    expect(scheduler.isDue(scheduler.add({ ...definition, id: 'a', cron: '30 10 * * *' }), now)).toBe(true);
    expect(scheduler.isDue(scheduler.add({ ...definition, id: 'b', cron: '* * * * *' }), now)).toBe(true);
    expect(scheduler.isDue(scheduler.add({ ...definition, id: 'c', cron: '15,45 9 * * *' }), now)).toBe(false);
  });

  it('respects enabled state', () => {
    const scheduler = new ReportScheduler();
    const disabled = scheduler.add({ ...definition, id: 'd', enabled: false });
    expect(scheduler.isDue(disabled, now)).toBe(false);
  });

  it('skips a definition that already ran this minute', () => {
    const scheduler = new ReportScheduler();
    const ran = scheduler.add({ ...definition, id: 'e', lastRun: '2024-01-08T10:30:00.000Z' });
    expect(scheduler.isDue(ran, now)).toBe(false);
    const earlier = scheduler.add({ ...definition, id: 'f', lastRun: '2024-01-08T09:30:00.000Z' });
    expect(scheduler.isDue(earlier, now)).toBe(true);
  });
});

describe('ReportScheduler.runDue', () => {
  const now = new Date('2024-01-08T10:30:00.000Z');

  it('runs due definitions and updates lastRun', async () => {
    const handler = vi.fn(async () => undefined);
    const scheduler = new ReportScheduler([{ ...definition, id: 's-1', cron: '30 10 * * *' }], handler);
    const due = await scheduler.runDue(now);
    expect(due).toHaveLength(1);
    expect(due[0]?.lastRun).toBe(now.toISOString());
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 's-1' }), now);
  });

  it('does not run non-matching or already-run definitions', async () => {
    const handler = vi.fn(async () => undefined);
    const scheduler = new ReportScheduler(
      [
        { ...definition, id: 'a', cron: '0 3 * * *' },
        { ...definition, id: 'b', cron: '30 10 * * *', lastRun: '2024-01-08T10:30:00.000Z' },
        { ...definition, id: 'c', cron: '30 10 * * *', enabled: false },
      ],
      handler,
    );
    const due = await scheduler.runDue(now);
    expect(due).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('throws when no handler is registered', async () => {
    const scheduler = new ReportScheduler([{ ...definition, id: 's-1', cron: '30 10 * * *' }]);
    await expect(scheduler.runDue(now)).rejects.toThrow(ReportScheduleError);
  });

  it('wraps handler failures in a ReportScheduleError', async () => {
    const handler = vi.fn(async () => {
      throw new Error('delivery failed');
    });
    const scheduler = new ReportScheduler([{ ...definition, id: 's-1', cron: '30 10 * * *' }], handler);
    await expect(scheduler.runDue(now)).rejects.toThrow(/Scheduled report 's-1' failed: delivery failed/);
  });

  it('wraps non-Error handler failures', async () => {
    const handler = vi.fn(async () => {
      throw 'delivery failed';
    });
    const scheduler = new ReportScheduler([{ ...definition, id: 's-1', cron: '30 10 * * *' }], handler);
    await expect(scheduler.runDue(now)).rejects.toThrow(/Scheduled report 's-1' failed: delivery failed/);
  });
});

/**
 * CSV serialization. `escapeCsvField` implements RFC 4180 quoting; the
 * renderer flattens a `Report` into labeled blocks (metadata, KPIs and each
 * section) so the output stays readable in spreadsheets and is deterministic.
 */

import type { Report } from './types.js';
import { datePart } from './utils.js';

/** Escapes a field per RFC 4180 (quote when it contains comma, quote or newline). */
export function escapeCsvField(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : value;
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/** Serializes a header + rows into a single CSV string (no trailing newline). */
export function toCsvRows(header: string[], rows: Array<Array<string | number>>): string {
  const lines = [header.map((cell) => escapeCsvField(cell)).join(',')];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvField(cell)).join(','));
  }
  return lines.join('\n');
}

/** Renders a `Report` as a labeled CSV document. */
export function renderReportToCsv(report: Report): string {
  const blocks: string[] = [];

  blocks.push(
    toCsvRows(
      ['report_id', 'name', 'template', 'kind', 'store_id', 'start', 'end', 'generated'],
      [
        [
          report.id,
          report.name,
          report.templateId,
          report.kind,
          report.storeId ?? '',
          report.period.startDate,
          report.period.endDate,
          report.generatedAt,
        ],
      ],
    ),
  );

  if (report.kpis.length > 0) {
    blocks.push(
      toCsvRows(
        ['KPI', 'Current', 'Previous', 'Change', 'Change %', 'Status'],
        report.kpis.map((kpi) => [
          kpi.label,
          kpi.value === null ? '' : kpi.value,
          kpi.previousValue === null ? '' : kpi.previousValue,
          kpi.change === null ? '' : kpi.change,
          kpi.changePercent === null ? '' : kpi.changePercent,
          kpi.status,
        ]),
      ),
    );
  }

  for (const section of report.sections) {
    blocks.push(`# ${section.title}`);
    if (section.points && section.points.length > 0) {
      blocks.push(
        toCsvRows(
          ['Date', 'Value'],
          section.points.map((point) => [point.date, point.value]),
        ),
      );
    } else if (section.header && section.rows && section.rows.length > 0) {
      blocks.push(toCsvRows(section.header, section.rows));
    } else if (section.metrics && section.metrics.length > 0) {
      blocks.push(
        toCsvRows(
          ['Metric', 'Value', 'Delta'],
          section.metrics.map((metric) => [
            metric.label,
            metric.value,
            metric.delta === undefined || metric.delta === null ? '' : metric.delta,
          ]),
        ),
      );
    } else if (section.body && section.body.length > 0) {
      blocks.push(toCsvRows(['Line'], section.body.map((line) => [line])));
    }
  }

  return blocks.join('\n\n');
}

/** Renders search rows as a CSV table (date, clicks, impressions, ctr, position). */
export function searchRowsToCsv(
  rows: Array<{ date: string; clicks: number; impressions: number; ctr: number; position: number }>,
): string {
  return toCsvRows(
    ['Date', 'Clicks', 'Impressions', 'CTR', 'Position'],
    rows.map((row) => [row.date, row.clicks, row.impressions, row.ctr, row.position]),
  );
}

/** Renders traffic rows as a CSV table (date, sessions, users, pageviews). */
export function trafficRowsToCsv(
  rows: Array<{ date: string; sessions: number; users: number; pageviews: number }>,
): string {
  return toCsvRows(
    ['Date', 'Sessions', 'Users', 'Page Views'],
    rows.map((row) => [datePart(row.date), row.sessions, row.users, row.pageviews]),
  );
}

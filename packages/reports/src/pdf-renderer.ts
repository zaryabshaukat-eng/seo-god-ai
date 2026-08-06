/**
 * PDF layout engine: renders a `Report` into a multi-page A4 PDF with
 * headings, paragraphs, key/value grids, tables and simple bar charts.
 * Pure output — no state leaks, deterministic for a given report.
 */

import type { Report, ReportSection, TrendPoint } from './types.js';
import { clamp, round } from './utils.js';
import { createPdfDocument, type PdfDocument } from './pdf-writer.js';

export interface PdfRenderOptions {
  title?: string;
  subtitle?: string;
  showGeneratedAt?: boolean;
  pageWidth?: number;
  pageHeight?: number;
  margin?: number;
}

const DEFAULT_MARGIN = 40;
const HEADER_COLOR = '#1a1a2e';
const ACCENT_COLOR = '#2e86de';
const MUTED_COLOR = '#666666';
const ROW_COLOR = '#f1f4f8';
const ROW_HEIGHT = 14;
const LINE_HEIGHT = 12;

function fit(text: string, width: number, size: number): string {
  const maxChars = Math.max(1, Math.floor(width / (size * 0.5)));
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3)}...`;
}

class PdfLayout {
  private readonly doc: PdfDocument;
  private readonly margin: number;
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private y: number;

  constructor(doc: PdfDocument, options: PdfRenderOptions) {
    this.doc = doc;
    this.margin = options.margin ?? DEFAULT_MARGIN;
    this.pageWidth = options.pageWidth ?? doc.pageWidth;
    this.pageHeight = options.pageHeight ?? doc.pageHeight;
    this.y = this.margin;
  }

  get contentWidth(): number {
    return this.pageWidth - this.margin * 2;
  }

  private ensure(space: number): void {
    if (this.y + space > this.pageHeight - this.margin) {
      this.doc.addPage();
      this.y = this.margin;
    }
  }

  title(text: string): void {
    this.ensure(24);
    this.doc.text(this.margin, this.y, text, { font: 'bold', size: 18, color: HEADER_COLOR });
    this.y += 24;
  }

  subtitle(text: string): void {
    this.ensure(13);
    this.doc.text(this.margin, this.y, text, { size: 10, color: MUTED_COLOR });
    this.y += 13;
  }

  heading(text: string): void {
    this.ensure(16);
    this.doc.text(this.margin, this.y, text, { font: 'bold', size: 12, color: HEADER_COLOR });
    this.y += 16;
  }

  paragraph(text: string): void {
    const size = 10;
    const charsPerLine = Math.max(1, Math.floor(this.contentWidth / (size * 0.5)));
    for (let index = 0; index < text.length; index += charsPerLine) {
      const line = text.slice(index, index + charsPerLine);
      this.ensure(LINE_HEIGHT);
      this.doc.text(this.margin, this.y, line, { size });
      this.y += LINE_HEIGHT;
    }
  }

  divider(): void {
    this.ensure(6);
    this.doc.line(this.margin, this.y, this.pageWidth - this.margin, this.y, {
      color: '#cccccc',
      width: 0.5,
    });
    this.y += 8;
  }

  keyValue(entries: Array<{ label: string; value: string | number }>): void {
    for (const entry of entries) {
      this.ensure(LINE_HEIGHT);
      this.doc.text(this.margin, this.y, fit(entry.label, this.contentWidth * 0.4, 10), {
        size: 10,
      });
      this.doc.text(this.margin + this.contentWidth * 0.42, this.y, String(entry.value), {
        size: 10,
        font: 'bold',
      });
      this.y += LINE_HEIGHT;
    }
  }

  table(header: string[], rows: Array<Array<string | number>>): void {
    const columns = header.length;
    const widths = Array.from({ length: columns }, () => this.contentWidth / columns);

    const drawRow = (cells: Array<string | number>, shaded: boolean): void => {
      this.ensure(ROW_HEIGHT);
      if (shaded) {
        this.doc.rect(this.margin, this.y, this.contentWidth, ROW_HEIGHT, { fill: ROW_COLOR });
      }
      let cursor = this.margin;
      for (let index = 0; index < columns; index += 1) {
        const cell = cells[index];
        const width = widths[index]!;
        const text = fit(cell === undefined ? '' : String(cell), width, 9);
        this.doc.text(cursor + 3, this.y + 3, text, { size: 9 });
        cursor += width;
      }
      this.y += ROW_HEIGHT;
    };

    this.ensure(ROW_HEIGHT);
    this.doc.rect(this.margin, this.y, this.contentWidth, ROW_HEIGHT, { fill: '#dde5ef', stroke: '#dde5ef' });
    let cursor = this.margin;
    for (let index = 0; index < columns; index += 1) {
      const width = widths[index]!;
      const text = fit(header[index]!, width, 9);
      this.doc.text(cursor + 3, this.y + 3, text, { size: 9, font: 'bold' });
      cursor += width;
    }
    this.y += ROW_HEIGHT;

    rows.forEach((row, rowIndex) => {
      drawRow(row, rowIndex % 2 === 1);
    });
  }

  bars(points: TrendPoint[], label: string, unit: string): void {
    const chartHeight = 100;
    const labelSpace = 16;
    this.ensure(chartHeight + labelSpace + 12);

    const max = Math.max(...points.map((point) => point.value), 1);
    const step = this.contentWidth / points.length;
    const barWidth = clamp(step * 0.6, 1, 40);
    const baseline = this.y + chartHeight;

    this.doc.text(this.margin, this.y, `${label}${unit === '' ? '' : ` (${unit})`}`, {
      size: 9,
      color: MUTED_COLOR,
    });
    this.y += 12;

    points.forEach((point, index) => {
      const barHeight = (point.value / max) * chartHeight;
      const x = this.margin + index * step + (step - barWidth) / 2;
      this.doc.rect(x, baseline - barHeight, barWidth, barHeight, { fill: ACCENT_COLOR });
      if (points.length <= 12) {
        this.doc.text(x, baseline - barHeight - 8, `${round(point.value)}`, {
          size: 7,
          color: MUTED_COLOR,
        });
      }
    });

    this.doc.line(this.margin, baseline, this.margin + this.contentWidth, baseline, {
      color: '#999999',
      width: 0.5,
    });

    const first = points[0];
    const last = points[points.length - 1];
    if (first !== undefined) {
      this.doc.text(this.margin, baseline + 4, first.date, { size: 7, color: MUTED_COLOR });
    }
    if (last !== undefined) {
      const lastLabel = last.date;
      const width = this.doc.measureText(lastLabel, 7);
      this.doc.text(this.margin + this.contentWidth - width, baseline + 4, lastLabel, {
        size: 7,
        color: MUTED_COLOR,
      });
    }
    this.y = baseline + labelSpace;
  }
}

function renderSection(layout: PdfLayout, section: ReportSection): void {
  layout.heading(section.title);
  if (section.description !== undefined) {
    layout.paragraph(section.description);
  }
  if (section.metrics !== undefined && section.metrics.length > 0) {
    layout.keyValue(
      section.metrics.map((metric) => ({
        label: metric.label,
        value: metric.delta === undefined || metric.delta === null
          ? metric.value
          : `${metric.value} (${metric.delta > 0 ? '+' : ''}${round(metric.delta)})`,
      })),
    );
  }
  if (section.points !== undefined && section.points.length > 0) {
    layout.bars(section.points, section.title, section.unit ?? '');
  }
  if (section.header !== undefined && section.rows !== undefined && section.rows.length > 0) {
    layout.table(section.header, section.rows);
  }
  if (section.body !== undefined && section.body.length > 0) {
    for (const line of section.body) {
      layout.paragraph(line);
    }
  }
}

/** Renders a `Report` to a PDF byte buffer. */
export function renderReportToPdf(report: Report, options: PdfRenderOptions = {}): Uint8Array {
  const doc = createPdfDocument({
    pageWidth: options.pageWidth,
    pageHeight: options.pageHeight,
  });
  const layout = new PdfLayout(doc, options);

  layout.title(options.title ?? report.name);
  const subtitleParts = [`Period: ${report.period.startDate} \u2013 ${report.period.endDate}`];
  if (report.storeId !== undefined) subtitleParts.push(`Store: ${report.storeId}`);
  if (report.previousPeriod !== undefined) {
    subtitleParts.push(`vs ${report.previousPeriod.startDate} \u2013 ${report.previousPeriod.endDate}`);
  }
  layout.subtitle(subtitleParts.join(' \u00b7 '));
  if (options.showGeneratedAt !== false) {
    layout.subtitle(`Generated: ${report.generatedAt}`);
  }
  layout.divider();

  for (const section of report.sections) {
    renderSection(layout, section);
  }

  return doc.toBuffer();
}

import { describe, expect, it } from 'vitest';
import { createPdfDocument, escapePdfText, parseColor } from './pdf-writer.js';

describe('parseColor', () => {
  it('parses hex colors', () => {
    expect(parseColor('#ff0000')).toEqual([1, 0, 0]);
    expect(parseColor('#000000')).toEqual([0, 0, 0]);
  });
  it('maps named colors', () => {
    expect(parseColor('black')).toEqual([0, 0, 0]);
    expect(parseColor('white')).toEqual([1, 1, 1]);
    expect(parseColor('gray')).toEqual([0.5019607843137255, 0.5019607843137255, 0.5019607843137255]);
    expect(parseColor('red')).toEqual([1, 0, 0]);
    expect(parseColor('blue')).toEqual([0.1803921568627451, 0.5254901960784314, 0.8705882352941177]);
  });
  it('falls back to black for unknown colors and bad hex', () => {
    expect(parseColor('not-a-color')).toEqual([0, 0, 0]);
    expect(parseColor('#zzz')).toEqual([0, 0, 0]);
  });
});

describe('escapePdfText', () => {
  it('escapes backslashes, parens and newlines', () => {
    expect(escapePdfText('a(b)\\c\n d')).toBe('(a\\(b\\)\\\\c  d)');
  });
});

describe('PdfDocument', () => {
  it('starts with A4 defaults', () => {
    const doc = createPdfDocument();
    expect(doc.pageWidth).toBeCloseTo(595.28);
    expect(doc.pageHeight).toBeCloseTo(841.89);
    expect(doc.pageCount).toBe(0);
  });

  it('supports custom page sizes', () => {
    const doc = createPdfDocument({ pageWidth: 400, pageHeight: 500 });
    expect(doc.pageWidth).toBe(400);
    expect(doc.pageHeight).toBe(500);
  });

  it('adds pages and measures text', () => {
    const doc = createPdfDocument();
    expect(doc.addPage()).toBe(0);
    expect(doc.addPage()).toBe(1);
    expect(doc.pageCount).toBe(2);
    expect(doc.measureText('abcd', 10)).toBe(20);
  });

  it('serializes a single page to a valid PDF 1.4 byte stream', () => {
    const doc = createPdfDocument({ pageWidth: 200, pageHeight: 300 });
    doc.text(10, 20, 'Hello (world)', { font: 'bold', size: 12, color: '#ff0000' });
    doc.line(0, 0, 100, 50, { color: '#000000', width: 1.5 });
    doc.rect(5, 5, 20, 10, { fill: '#cccccc' });
    doc.rect(30, 5, 20, 10, { stroke: '#000000' });
    doc.rect(55, 5, 20, 10, { fill: '#ffffff', stroke: '#000000' });
    doc.rect(80, 5, 20, 10);
    const bytes = doc.toBuffer();
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/MediaBox [0 0 200 300]');
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toContain('/BaseFont /Helvetica-Bold');
    expect(text).toContain('BT /F2 12 Tf');
    expect(text).toContain('re f');
    expect(text).toContain('re S');
    expect(text).toContain('re B');
    expect(text).toContain('startxref');
    expect(text.endsWith('%%EOF\n')).toBe(true);
  });

  it('serializes multiple pages with distinct objects', () => {
    const doc = createPdfDocument();
    doc.addPage();
    doc.addPage();
    doc.text(5, 5, 'a');
    const text = new TextDecoder().decode(doc.toBuffer());
    expect(text).toContain('/Kids [5 0 R 7 0 R]');
    expect(text).toContain('/Count 2');
  });

  it('toBuffer creates a page when none exist', () => {
    const doc = createPdfDocument();
    const text = new TextDecoder().decode(doc.toBuffer());
    expect(text).toContain('/Count 1');
  });
});

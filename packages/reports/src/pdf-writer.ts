/**
 * Minimal, dependency-free PDF writer. Produces a valid PDF 1.4 document using
 * the two base-14 Helvetica faces (no font embedding) with text, lines and
 * filled/stroked rectangles. Coordinates are top-left origin, y grows
 * downward; internally they are translated to PDF's bottom-up user space.
 *
 * The writer is intentionally low-level; layout lives in `pdf-renderer.ts`.
 */

export interface PdfDocumentOptions {
  pageWidth?: number;
  pageHeight?: number;
}

export type PdfFont = 'normal' | 'bold';

export interface PdfTextOptions {
  font?: PdfFont;
  size?: number;
  color?: string;
}

export interface PdfLineOptions {
  color?: string;
  width?: number;
}

export interface PdfRectOptions {
  fill?: string;
  stroke?: string;
  width?: number;
}

const FONT_NAME: Record<PdfFont, string> = { normal: '/F1', bold: '/F2' };
const DEFAULT_PAGE_WIDTH = 595.28;
const DEFAULT_PAGE_HEIGHT = 841.89;

/** A4 portrait default document. */
export function createPdfDocument(options: PdfDocumentOptions = {}): PdfDocument {
  return new PdfDocument({
    pageWidth: options.pageWidth ?? DEFAULT_PAGE_WIDTH,
    pageHeight: options.pageHeight ?? DEFAULT_PAGE_HEIGHT,
  });
}

interface PdfPage {
  ops: string[];
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function format(value: number): string {
  return `${Math.round(value * 100) / 100}`;
}

/** Parses `#RRGGBB` or a named color into 0..1 RGB components. */
export function parseColor(color: string): [number, number, number] {
  let hex = '';
  if (color.startsWith('#')) {
    hex = color.slice(1);
  } else {
    switch (color) {
      case 'black':
        hex = '000000';
        break;
      case 'white':
        hex = 'ffffff';
        break;
      case 'gray':
        hex = '808080';
        break;
      case 'red':
        hex = 'ff0000';
        break;
      case 'blue':
        hex = '2e86de';
        break;
      default:
        hex = '000000';
    }
  }
  const normalize = (value: number): number => (Number.isFinite(value) ? value : 0);
  const r = normalize(parseInt(hex.slice(0, 2), 16) / 255);
  const g = normalize(parseInt(hex.slice(2, 4), 16) / 255);
  const b = normalize(parseInt(hex.slice(4, 6), 16) / 255);
  return [r, g, b];
}

/** Escapes a string for a PDF literal-string operand `( ... )`. */
export function escapePdfText(value: string): string {
  const sanitized = value.replace(/[\r\n]/g, ' ');
  return `(${sanitized.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')})`;
}

export class PdfDocument {
  readonly pageWidth: number;
  readonly pageHeight: number;
  private readonly pages: PdfPage[] = [];

  constructor(options: PdfDocumentOptions) {
    this.pageWidth = options.pageWidth ?? DEFAULT_PAGE_WIDTH;
    this.pageHeight = options.pageHeight ?? DEFAULT_PAGE_HEIGHT;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Starts a new page and returns its index. */
  addPage(): number {
    this.pages.push({ ops: [] });
    return this.pages.length - 1;
  }

  /** Approximate rendered width of a string at a given size. */
  measureText(value: string, size: number): number {
    return value.length * size * 0.5;
  }

  /** Draws a text line. `y` is the top of the line. */
  text(x: number, y: number, content: string, options: PdfTextOptions = {}): void {
    const page = this.pageForWrite();
    const font = options.font ?? 'normal';
    const size = options.size ?? 11;
    const [r, g, b] = parseColor(options.color ?? '#000000');
    const baseline = this.pageHeight - y - size * 0.8;
    page.ops.push(`${format(r)} ${format(g)} ${format(b)} rg`);
    page.ops.push(
      `BT ${FONT_NAME[font]} ${size} Tf ${format(x)} ${format(baseline)} Tj ${escapePdfText(content)} ET`,
    );
  }

  /** Draws a straight line segment. Coordinates are top-left origin. */
  line(x1: number, y1: number, x2: number, y2: number, options: PdfLineOptions = {}): void {
    const page = this.pageForWrite();
    const [r, g, b] = parseColor(options.color ?? '#000000');
    const width = options.width ?? 1;
    page.ops.push(`${format(r)} ${format(g)} ${format(b)} RG`);
    page.ops.push(`${format(width)} w`);
    page.ops.push(
      `${format(x1)} ${format(this.pageHeight - y1)} m ${format(x2)} ${format(this.pageHeight - y2)} l S`,
    );
  }

  /** Draws a rectangle; fills black when neither fill nor stroke is given. */
  rect(x: number, y: number, w: number, h: number, options: PdfRectOptions = {}): void {
    const page = this.pageForWrite();
    const fill = options.fill ?? (options.stroke === undefined ? '#000000' : undefined);
    const stroke = options.stroke;
    if (fill !== undefined) {
      const [r, g, b] = parseColor(fill);
      page.ops.push(`${format(r)} ${format(g)} ${format(b)} rg`);
    }
    if (stroke !== undefined) {
      const [r, g, b] = parseColor(stroke);
      const width = options.width ?? 1;
      page.ops.push(`${format(r)} ${format(g)} ${format(b)} RG`);
      page.ops.push(`${format(width)} w`);
    }
    const pdfY = this.pageHeight - y - h;
    const op = fill !== undefined && stroke !== undefined ? 'B' : fill !== undefined ? 'f' : 'S';
    page.ops.push(`${format(x)} ${format(pdfY)} ${format(w)} ${format(h)} re ${op}`);
  }

  /** Serializes the document to bytes. */
  toBuffer(): Uint8Array {
    if (this.pages.length === 0) this.addPage();

    const parts: string[] = ['%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n'];
    const offsets: number[] = [];
    let offset = byteLength(parts[0] ?? '');

    const push = (number: number, body: string): void => {
      offsets[number] = offset;
      const part = `${number} 0 obj\n${body}\nendobj\n`;
      parts.push(part);
      offset += byteLength(part);
    };

    push(1, '<< /Type /Catalog /Pages 2 0 R >>');
    const kids = this.pages.map((_, index) => `${5 + index * 2} 0 R`).join(' ');
    push(2, `<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`);
    push(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    push(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

    this.pages.forEach((page, index) => {
      const pageNumber = 5 + index * 2;
      const contentNumber = 6 + index * 2;
      push(
        pageNumber,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`,
      );
      const stream = page.ops.join('\n');
      const length = byteLength(stream);
      push(contentNumber, `<< /Length ${length} >>\nstream\n${stream}\nendstream`);
    });

    const xrefOffset = offset;
    const count = 5 + this.pages.length * 2;
    let xref = `xref\n0 ${count}\n`;
    xref += '0000000000 65535 f \n';
    for (let number = 1; number < count; number += 1) {
      const entryOffset = offsets[number] ?? 0;
      xref += `${entryOffset.toString().padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    parts.push(xref);

    return new TextEncoder().encode(parts.join(''));
  }

  private pageForWrite(): PdfPage {
    if (this.pages.length === 0) this.addPage();
    const page = this.pages[this.pages.length - 1];
    if (page === undefined) return this.addPageAndGet();
    return page;
  }

  private addPageAndGet(): PdfPage {
    this.addPage();
    const page = this.pages[this.pages.length - 1];
    if (page === undefined) {
      throw new Error('failed to create PDF page');
    }
    return page;
  }
}

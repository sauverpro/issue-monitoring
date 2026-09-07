/**
 * A cursor-based, auto-paginating layer on top of SimplePdf. Unlike SimplePdf's absolute
 * x/y drawing (used by the dashboard-style report), FlowDoc tracks a running vertical
 * cursor and starts a new page (re-painting the background + running header via
 * `onNewPage`) whenever the next element wouldn't fit — including mid-paragraph and
 * mid-table continuation (a table's header row is redrawn on the page it continues onto).
 */
import { SimplePdf, wrapText, type PdfColor } from "./simplePdf.js";

export type FlowTheme = {
  ink: PdfColor;
  muted: PdfColor;
  line: PdfColor;
  accent: PdfColor;
  tableHeaderBg: PdfColor;
  tableHeaderText: PdfColor;
  stripe: PdfColor;
};

export type TableCol = { label: string; width: number; align?: "left" | "right" };

export type TableOpts = {
  cellColor?: (row: string[], colIndex: number, rowIndex: number) => PdfColor | undefined;
  textColor?: (row: string[], colIndex: number, rowIndex: number) => PdfColor | undefined;
  boldCell?: (row: string[], colIndex: number, rowIndex: number) => boolean;
  gapAfter?: number;
  /** Wrap each cell onto multiple lines (row height grows to fit) instead of truncating to one line. */
  wrap?: boolean;
};

export type CalloutScheme = { bg: PdfColor; accent: PdfColor; titleColor?: PdfColor };

export class FlowDoc {
  readonly pdf: SimplePdf;
  private y: number;
  private readonly marginX: number;
  private readonly contentTop: number;
  private readonly contentBottom: number;
  private readonly theme: FlowTheme;
  private readonly onNewPage: (pdf: SimplePdf, pageIndex: number) => void;

  constructor(
    pdf: SimplePdf,
    opts: {
      marginX: number;
      contentTop: number;
      contentBottom: number;
      theme: FlowTheme;
      onNewPage: (pdf: SimplePdf, pageIndex: number) => void;
    }
  ) {
    this.pdf = pdf;
    this.marginX = opts.marginX;
    this.contentTop = opts.contentTop;
    this.contentBottom = opts.contentBottom;
    this.theme = opts.theme;
    this.onNewPage = opts.onNewPage;
    this.pdf.addPage();
    this.onNewPage(this.pdf, this.pdf.pageCount - 1);
    this.y = this.contentTop;
  }

  get contentWidth(): number {
    return this.pdf.w - this.marginX * 2;
  }

  get cursorY(): number {
    return this.y;
  }

  newPage(): void {
    this.pdf.addPage();
    this.onNewPage(this.pdf, this.pdf.pageCount - 1);
    this.y = this.contentTop;
  }

  ensureSpace(height: number): void {
    if (this.y + height > this.contentBottom) this.newPage();
  }

  spacer(h: number): void {
    this.y += h;
  }

  heading(number: string, title: string): void {
    this.ensureSpace(34);
    this.pdf.text(`${number}. ${title}`, this.marginX, this.y, { size: 15, bold: true, color: this.theme.ink });
    this.y += 20;
    this.pdf.stroke(this.theme.accent);
    this.pdf.lineWidth(1.6);
    this.pdf.line(this.marginX, this.y, this.marginX + 46, this.y);
    this.y += 14;
  }

  subheading(title: string): void {
    this.ensureSpace(22);
    this.pdf.text(title, this.marginX, this.y, { size: 10.5, bold: true, color: this.theme.ink });
    this.y += 18;
  }

  para(text: string, opts: { size?: number; bold?: boolean; color?: PdfColor; lineHeight?: number } = {}): void {
    const size = opts.size ?? 9.5;
    const bold = opts.bold ?? false;
    const lh = opts.lineHeight ?? Math.round(size * 1.5);
    const lines = wrapText(text, this.contentWidth, size, bold);
    for (const line of lines) {
      this.ensureSpace(lh);
      this.pdf.text(line, this.marginX, this.y, { size, bold, color: opts.color ?? this.theme.ink });
      this.y += lh;
    }
    this.y += 6;
  }

  table(cols: TableCol[], rows: string[][], opts: TableOpts = {}): void {
    const headerH = 22;
    const w = this.contentWidth;
    const wrap = opts.wrap ?? false;
    const cellSize = 8.5;
    const lineH = 11;

    const drawHeader = () => {
      this.pdf.fill(this.theme.tableHeaderBg);
      this.pdf.rect(this.marginX, this.y, w, headerH, "f");
      let cx = this.marginX;
      for (const col of cols) {
        this.pdf.text(col.label, col.align === "right" ? cx + col.width - 8 : cx + 8, this.y + 6, {
          size: 8,
          bold: true,
          color: this.theme.tableHeaderText,
          align: col.align === "right" ? "right" : "left",
          maxWidth: col.width - 12,
        });
        cx += col.width;
      }
      this.y += headerH;
    };

    const rowHeight = (row: string[]): number => {
      if (!wrap) return 20;
      let maxLines = 1;
      cols.forEach((col, ci) => {
        const lines = wrapText(row[ci] ?? "", col.width - 12, cellSize);
        maxLines = Math.max(maxLines, lines.length || 1);
      });
      return maxLines * lineH + 9;
    };

    this.ensureSpace(headerH + rowHeight(rows[0] ?? []));
    drawHeader();

    rows.forEach((row, ri) => {
      const rh = rowHeight(row);
      if (this.y + rh > this.contentBottom) {
        this.newPage();
        drawHeader();
      }
      if (ri % 2 === 1) {
        this.pdf.fill(this.theme.stripe);
        this.pdf.rect(this.marginX, this.y, w, rh, "f");
      }
      let cx = this.marginX;
      cols.forEach((col, ci) => {
        const bg = opts.cellColor?.(row, ci, ri);
        if (bg) {
          this.pdf.fill(bg);
          this.pdf.rect(cx, this.y, col.width, rh, "f");
        }
        const color = opts.textColor?.(row, ci, ri) ?? this.theme.ink;
        const bold = opts.boldCell?.(row, ci, ri) ?? false;
        const tx = col.align === "right" ? cx + col.width - 8 : cx + 8;
        if (wrap) {
          const lines = wrapText(row[ci] ?? "", col.width - 12, cellSize, bold);
          lines.forEach((line, li) => {
            this.pdf.text(line, tx, this.y + 5 + li * lineH, {
              size: cellSize,
              bold,
              color,
              align: col.align === "right" ? "right" : "left",
            });
          });
        } else {
          this.pdf.text(row[ci] ?? "", tx, this.y + 5, {
            size: cellSize,
            bold,
            color,
            align: col.align === "right" ? "right" : "left",
            maxWidth: col.width - 12,
          });
        }
        cx += col.width;
      });
      this.pdf.stroke(this.theme.line);
      this.pdf.lineWidth(0.4);
      this.pdf.line(this.marginX, this.y + rh, this.marginX + w, this.y + rh);
      this.y += rh;
    });
    this.y += opts.gapAfter ?? 14;
  }

  callout(title: string, text: string, scheme: CalloutScheme): void {
    const w = this.contentWidth;
    const lines = wrapText(text, w - 28, 9);
    const h = 30 + lines.length * 13 + 10;
    this.ensureSpace(h + 12);
    this.pdf.fill(scheme.bg);
    this.pdf.rect(this.marginX, this.y, w, h, "f");
    this.pdf.fill(scheme.accent);
    this.pdf.rect(this.marginX, this.y, 4, h, "f");
    this.pdf.text(title, this.marginX + 16, this.y + 14, { size: 9.5, bold: true, color: scheme.titleColor ?? scheme.accent });
    let ly = this.y + 30;
    for (const line of lines) {
      this.pdf.text(line, this.marginX + 16, ly, { size: 8.5, color: this.theme.ink });
      ly += 13;
    }
    this.y += h + 14;
  }

  bulletList(items: string[]): void {
    for (const item of items) this.listItem(this.theme.accent, null, item);
  }

  numberedList(items: string[]): void {
    items.forEach((item, i) => this.listItem(null, `${i + 1}.`, item));
  }

  private listItem(markerColor: PdfColor | null, markerLabel: string | null, text: string, indent = 18): void {
    const w = this.contentWidth - indent;
    const lines = wrapText(text, w, 9);
    const lh = 13;
    this.ensureSpace(lines.length * lh + 6);
    if (markerColor) {
      this.pdf.fill(markerColor);
      this.pdf.rect(this.marginX + 2, this.y + 2, 5, 5, "f");
    } else if (markerLabel) {
      this.pdf.text(markerLabel, this.marginX, this.y, { size: 9, bold: true, color: this.theme.ink });
    }
    for (const line of lines) {
      this.pdf.text(line, this.marginX + indent, this.y, { size: 9, color: this.theme.ink });
      this.y += lh;
    }
    this.y += 6;
  }

  finish(footerFn: (pdf: SimplePdf, pageIndex: number, pageCount: number) => void): Buffer {
    const count = this.pdf.pageCount;
    for (let i = 0; i < count; i++) {
      this.pdf.usePage(i);
      footerFn(this.pdf, i, count);
    }
    return this.pdf.toBuffer();
  }
}

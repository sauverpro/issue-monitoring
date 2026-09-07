/** Minimal PDF 1.4 writer (Helvetica / Helvetica-Bold). Coordinates are top-down. */

export type PdfColor = [number, number, number];

export const A4_LANDSCAPE = { w: 842, h: 595 };
export const A4_PORTRAIT = { w: 595, h: 842 };

export function hexColor(hex: string): PdfColor {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function pdfSafe(value: string): string {
  return [...value]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (c === 0x2013 || c === 0x2014) return "-";
      if (c === 0x2018 || c === 0x2019) return "'";
      if (c === 0x201c || c === 0x201d) return '"';
      if (c === 0x2026) return "...";
      if (c === 0x2192) return "->";
      if (c === 0x2190) return "<-";
      if (c === 0x2191) return "^";
      if (c === 0x2193) return "v";
      if (c === 0x2022) return "-";
      if (c === 0x25cf) return "-";
      if (c < 32) return " ";
      if (c > 255) return "?";
      return ch;
    })
    .join("");
}

export function pdfString(value: string): string {
  let out = "(";
  for (const ch of pdfSafe(value)) {
    const c = ch.charCodeAt(0);
    if (ch === "\\" || ch === "(" || ch === ")") out += `\\${ch}`;
    else if (c === 10) out += "\\n";
    else if (c === 13) out += "\\r";
    else if (c < 32 || c > 126) out += `\\${c.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return `${out})`;
}

export function measureText(text: string, size: number, bold = false): number {
  return pdfSafe(text).length * size * (bold ? 0.55 : 0.5);
}

export function truncateText(text: string, size: number, maxWidth: number, bold = false): string {
  const safe = pdfSafe(text);
  if (measureText(safe, size, bold) <= maxWidth) return safe;
  let s = safe;
  while (s.length > 1 && measureText(`${s}...`, size, bold) > maxWidth) s = s.slice(0, -1);
  return `${s}...`;
}

/** Greedy word-wrap into lines that each fit within maxWidth at the given size. */
export function wrapText(text: string, maxWidth: number, size: number, bold = false): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (!current || measureText(attempt, size, bold) <= maxWidth) {
      current = attempt;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

type TextOpts = {
  size?: number;
  bold?: boolean;
  color?: PdfColor;
  align?: "left" | "right" | "center";
  maxWidth?: number;
};

export class SimplePdf {
  readonly w: number;
  readonly h: number;
  private pages: string[][] = [];
  private pageIndex = 0;

  constructor(size: { w: number; h: number } = A4_LANDSCAPE) {
    this.w = size.w;
    this.h = size.h;
    this.addPage();
  }

  get pageCount(): number {
    return this.pages.length;
  }

  usePage(index: number): void {
    if (index < 0 || index >= this.pages.length) {
      throw new Error(`PDF page ${index} does not exist`);
    }
    this.pageIndex = index;
  }

  addPage(): void {
    this.pages.push([]);
    this.pageIndex = this.pages.length - 1;
  }

  private op(cmd: string): void {
    this.pages[this.pageIndex]!.push(cmd);
  }

  private ty(yFromTop: number): number {
    return this.h - yFromTop;
  }

  fill(color: PdfColor): void {
    this.op(`${color.map((c) => c.toFixed(3)).join(" ")} rg`);
  }

  stroke(color: PdfColor): void {
    this.op(`${color.map((c) => c.toFixed(3)).join(" ")} RG`);
  }

  lineWidth(width: number): void {
    this.op(`${width} w`);
  }

  rect(x: number, yFromTop: number, w: number, h: number, mode: "f" | "S" | "B" = "f"): void {
    this.op(`${n(x)} ${n(this.ty(yFromTop + h))} ${n(w)} ${n(h)} re ${mode}`);
  }

  line(x1: number, y1: number, x2: number, y2: number): void {
    this.op(`${n(x1)} ${n(this.ty(y1))} m ${n(x2)} ${n(this.ty(y2))} l S`);
  }

  polyline(points: { x: number; y: number }[], close = false): void {
    if (points.length === 0) return;
    const [first, ...rest] = points;
    let cmd = `${n(first!.x)} ${n(this.ty(first!.y))} m`;
    for (const p of rest) cmd += ` ${n(p.x)} ${n(this.ty(p.y))} l`;
    if (close) cmd += " h";
    this.op(`${cmd} S`);
  }

  polygon(points: { x: number; y: number }[], mode: "f" | "S" | "B" = "f"): void {
    if (points.length === 0) return;
    const [first, ...rest] = points;
    let cmd = `${n(first!.x)} ${n(this.ty(first!.y))} m`;
    for (const p of rest) cmd += ` ${n(p.x)} ${n(this.ty(p.y))} l`;
    this.op(`${cmd} h ${mode}`);
  }

  text(value: string, x: number, yFromTop: number, opts: TextOpts = {}): void {
    const size = opts.size ?? 10;
    const bold = opts.bold ?? false;
    let str = pdfSafe(value);
    if (opts.maxWidth) str = truncateText(str, size, opts.maxWidth, bold);
    const width = measureText(str, size, bold);
    let drawX = x;
    if (opts.align === "right") drawX = x - width;
    if (opts.align === "center") drawX = x - width / 2;
    if (opts.color) this.fill(opts.color);
    const baseline = this.ty(yFromTop) - size * 0.78;
    this.op(`BT /${bold ? "F2" : "F1"} ${n(size)} Tf ${n(drawX)} ${n(baseline)} Td ${pdfString(str)} Tj ET`);
  }

  /** Word-wraps and draws a multi-line block; returns the y position just below the last line. */
  paragraph(
    value: string,
    x: number,
    yFromTop: number,
    maxWidth: number,
    opts: { size?: number; bold?: boolean; color?: PdfColor; lineHeight?: number; maxLines?: number } = {}
  ): number {
    const size = opts.size ?? 8.5;
    const bold = opts.bold ?? false;
    let lines = wrapText(value, maxWidth, size, bold);
    if (opts.maxLines && lines.length > opts.maxLines) {
      lines = lines.slice(0, opts.maxLines);
      const last = lines[lines.length - 1] ?? "";
      lines[lines.length - 1] = `${last}...`;
    }
    const lh = opts.lineHeight ?? Math.round(size * 1.45);
    lines.forEach((line, i) => {
      this.text(line, x, yFromTop + i * lh, { size, bold, color: opts.color });
    });
    return yFromTop + lines.length * lh;
  }

  toBuffer(): Buffer {
    const streams = this.pages.map((ops) => ops.join("\n"));
    return assemblePdf(this.w, this.h, streams);
  }
}

function n(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function assemblePdf(w: number, h: number, streams: string[]): Buffer {
  const pageCount = streams.length;
  let nextId = 5;
  const contentIds: number[] = [];
  const pageIds: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    contentIds.push(nextId++);
    pageIds.push(nextId++);
  }

  const objects: string[] = new Array(nextId);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  for (let i = 0; i < pageCount; i++) {
    const stream = streams[i]!;
    const length = Buffer.byteLength(stream, "latin1");
    objects[contentIds[i]!] = `<< /Length ${length} >>\nstream\n${stream}\nendstream`;
    objects[pageIds[i]!] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentIds[i]} 0 R >>`;
  }

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (let i = 1; i < nextId; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${nextId}\n`;
  out += "0000000000 65535 f \n";
  for (let i = 1; i < nextId; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer << /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

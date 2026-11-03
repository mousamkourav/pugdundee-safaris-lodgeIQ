// "Download PDF" of a published SOP version: cover (title, version, date), contents with page
// numbers (each line a link), every section from a new page, page numbers on every page.
// A5 pages and 10 pt text: readable on a phone without zooming. Built with jsPDF (text, so the
// file is small and searchable). Runs on the server (route /sop/pdf) and in tests.
import { jsPDF } from "jspdf";
import type { Doc, PMNode } from "./types";

export interface PdfImage {
  data: Uint8Array;
  format: "PNG" | "JPEG";
  width: number; // pixels
  height: number;
}
export interface PdfInput {
  title: string;
  version: number;
  published: string; // "3 Nov 2026"
  sections: { title: string; body: Doc }[];
  images?: Map<string, PdfImage>; // by the picture's src (/sop/media/images/...)
  compress?: boolean;
}

// The PDF's built-in fonts know Windows-1252 characters only: others are spelt out or dropped.
const WIN = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
const SPELL: Record<string, string> = { "\u20b9": "Rs.", "\u2212": "-", "\u2010": "-", "\u2011": "-", "\u2192": "->", "\u2190": "<-", "\u2713": "v", "\u25cf": "\u2022", "\u25aa": "\u2022", "\uf0b7": "\u2022", "\u00a0": " ", "\u200b": "" };
export function pdfText(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10) out += " ";
    else if ((c >= 0x20 && c < 0x7f) || (c >= 0xa1 && c <= 0xff) || WIN.has(c)) out += ch;
    else if (SPELL[ch] != null) out += SPELL[ch];
    else {
      const plain = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      if ([...plain].every((x) => x.charCodeAt(0) < 0x7f)) out += plain;
    }
  }
  return out;
}

const PAGE_W = 148;
const PAGE_H = 210;
const M = 14; // side margins
const TOP = 16;
const BOTTOM = PAGE_H - 18; // the footer sits below
const W = PAGE_W - 2 * M;
const PT = 0.3528; // mm per point
// brand tokens (app/globals.css): olive-600, sand-700, sand-500, sand-200, sand-100
const OLIVE: [number, number, number] = [0x5a, 0x6b, 0x2f];
const DARK: [number, number, number] = [0x4f, 0x45, 0x31];
const GREY: [number, number, number] = [0x8a, 0x7a, 0x56];
const LINE: [number, number, number] = [0xe6, 0xdd, 0xca];
const FILL: [number, number, number] = [0xf2, 0xed, 0xe1];

const inlineText = (n: PMNode): string => (n.type === "text" ? n.text ?? "" : n.type === "hardBreak" ? "\n" : (n.content ?? []).map(inlineText).join(""));
const allBold = (n: PMNode): boolean => {
  const texts: PMNode[] = [];
  const walk = (x: PMNode) => (x.type === "text" ? texts.push(x) : (x.content ?? []).forEach(walk));
  walk(n);
  return texts.length > 0 && texts.every((t) => (t.marks ?? []).some((m) => m.type === "bold"));
};

export function buildSopPdf(input: PdfInput): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait", compress: input.compress ?? true });
  doc.setProperties({ title: `${input.title} - version ${input.version}`, author: "Pugdundee Safaris", subject: "Standard operating procedures" });
  let y = TOP;

  const lh = (size: number) => size * PT * 1.45;
  const newPage = () => {
    doc.addPage("a5", "portrait");
    y = TOP;
  };
  const ensure = (h: number) => {
    if (y + h > BOTTOM) newPage();
  };
  const write = (text: string, opt: { size?: number; bold?: boolean; indent?: number; color?: [number, number, number]; after?: number; marker?: string } = {}) => {
    const size = opt.size ?? 10;
    const indent = opt.indent ?? 0;
    doc.setFont("helvetica", opt.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(opt.color ?? DARK));
    const parts = pdfText(text).split("\n");
    const lines = parts.flatMap((p) => (doc.splitTextToSize(p, W - indent) as string[]));
    const h = lh(size);
    lines.forEach((line, i) => {
      ensure(h);
      if (i === 0 && opt.marker) {
        doc.setFont("helvetica", "normal");
        doc.text(pdfText(opt.marker), M + indent - 4.5, y + h * 0.75);
        doc.setFont("helvetica", opt.bold ? "bold" : "normal");
      }
      doc.text(line, M + indent, y + h * 0.75);
      y += h;
    });
    y += opt.after ?? 1.6;
  };

  // ---------------------------------------------------------------- cover
  doc.setFillColor(...OLIVE);
  doc.rect(0, 0, PAGE_W, 74, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("PUGDUNDEE SAFARIS", M, 30);
  doc.setFontSize(22);
  doc.text(doc.splitTextToSize(pdfText(input.title), W) as string[], M, 48);
  doc.setTextColor(...DARK);
  doc.setFontSize(13);
  doc.text(`Version ${input.version}`, M, 96);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Published ${pdfText(input.published)}`, M, 104);
  doc.setTextColor(...GREY);
  doc.setFontSize(9);
  doc.text(`${input.sections.length} sections. Contents on the next page.`, M, 116);
  doc.text("For Pugdundee Safaris staff. Always use the latest version in LodgeIQ.", M, BOTTOM);

  // ---------------------------------------------------------------- contents: room for it first
  const tocSize = 9.5;
  doc.setFontSize(tocSize);
  const tocLines = input.sections.map((s) => (doc.splitTextToSize(pdfText(s.title), W - 12) as string[]).length);
  const tocHeight = 14 + tocLines.reduce((t, n) => t + n * lh(tocSize) + 1.2, 0);
  const perPage = BOTTOM - TOP;
  const tocPages = Math.max(1, Math.ceil(tocHeight / perPage));
  const tocFirst = 2;
  for (let i = 0; i < tocPages; i++) newPage();

  // ---------------------------------------------------------------- sections
  const starts: number[] = [];
  const block = (n: PMNode, indent: number, marker?: string) => {
    switch (n.type) {
      case "heading":
        ensure(lh(11.5) * 3); // keep a heading with the lines after it
        y += 1.5;
        write(inlineText(n), { size: Number(n.attrs?.level) === 4 ? 10.5 : 11.5, bold: true, indent, color: OLIVE, after: 1 });
        break;
      case "paragraph": {
        const t = inlineText(n).trim();
        if (t) write(t, { bold: allBold(n), indent, marker });
        else if (marker) write(" ", { indent, marker });
        for (const c of n.content ?? []) if (c.type === "image") block(c, indent);
        break;
      }
      case "bulletList":
      case "orderedList": {
        let k = Number(n.attrs?.start) || 1;
        for (const li of n.content ?? []) {
          const mark = n.type === "bulletList" ? "\u2022" : `${k++}.`;
          (li.content ?? []).forEach((c, i) => block(c, indent + 5, i === 0 && (c.type === "paragraph" || c.type === "heading") ? mark : undefined));
        }
        y += 0.8;
        break;
      }
      case "blockquote":
        (n.content ?? []).forEach((c) => block(c, indent + 4));
        break;
      case "horizontalRule":
        ensure(4);
        doc.setDrawColor(...LINE);
        doc.line(M, y + 2, M + W, y + 2);
        y += 4;
        break;
      case "table":
        table(n, indent);
        break;
      case "image":
        image(n, indent);
        break;
      default:
        (n.content ?? []).forEach((c) => block(c, indent));
    }
  };

  const table = (t: PMNode, indent: number) => {
    const rows = t.content ?? [];
    const cols = Math.max(1, ...rows.map((r) => (r.content ?? []).reduce((s, c) => s + (Number(c.attrs?.colspan) || 1), 0)));
    const colW = (W - indent) / cols;
    const size = cols > 4 ? 7.5 : 8.5;
    const h = lh(size);
    const pad = 1.4;
    y += 1;
    for (const r of rows) {
      const cells = (r.content ?? []).map((c) => {
        const span = Number(c.attrs?.colspan) || 1;
        const text = (c.content ?? []).map(inlineText).join("\n").trim();
        doc.setFont("helvetica", c.type === "tableHeader" ? "bold" : "normal");
        doc.setFontSize(size);
        const lines = pdfText(text).split("\n").flatMap((p) => doc.splitTextToSize(p, colW * span - 2 * pad) as string[]);
        return { span, lines: lines.slice(0, 60), header: c.type === "tableHeader" };
      });
      const rowH = Math.max(...cells.map((c) => c.lines.length), 1) * h + 2 * pad;
      ensure(Math.min(rowH, BOTTOM - TOP));
      let x = M + indent;
      doc.setDrawColor(...LINE);
      for (const c of cells) {
        const cw = colW * c.span;
        if (c.header) {
          doc.setFillColor(...FILL);
          doc.rect(x, y, cw, rowH, "FD");
        } else doc.rect(x, y, cw, rowH);
        doc.setFont("helvetica", c.header ? "bold" : "normal");
        doc.setFontSize(size);
        doc.setTextColor(...DARK);
        c.lines.forEach((line, i) => doc.text(line, x + pad, y + pad + h * (i + 0.75)));
        x += cw;
      }
      y += rowH;
    }
    y += 2.5;
  };

  const image = (n: PMNode, indent: number) => {
    const img = input.images?.get(String(n.attrs?.src ?? ""));
    if (!img || !img.width || !img.height) return;
    const maxW = W - indent;
    const maxH = 110;
    let w = maxW;
    let h = (img.height / img.width) * w;
    if (h > maxH) {
      h = maxH;
      w = (img.width / img.height) * h;
    }
    ensure(h + 2);
    try {
      doc.addImage(img.data, img.format, M + indent, y, w, h);
      y += h + 3;
    } catch {
      // a picture the PDF cannot read is left out, the text is still there
    }
  };

  for (const s of input.sections) {
    newPage();
    starts.push(doc.getNumberOfPages());
    write(s.title, { size: 15, bold: true, color: OLIVE, after: 3 });
    doc.setDrawColor(...OLIVE);
    doc.setLineWidth(0.4);
    doc.line(M, y - 1.5, M + 24, y - 1.5);
    doc.setLineWidth(0.2);
    y += 2;
    for (const n of s.body?.content ?? []) block(n, 0);
  }

  // ---------------------------------------------------------------- contents, now the pages are known
  let page = tocFirst;
  doc.setPage(page);
  y = TOP;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...OLIVE);
  doc.text("Contents", M, y + 6);
  y += 14;
  input.sections.forEach((s, i) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(tocSize);
    const lines = doc.splitTextToSize(pdfText(s.title), W - 12) as string[];
    const h = lines.length * lh(tocSize);
    if (y + h > BOTTOM && page < tocFirst + tocPages - 1) {
      doc.setPage(++page);
      y = TOP;
    }
    doc.setTextColor(...DARK);
    lines.forEach((line, k) => doc.text(line, M, y + lh(tocSize) * (k + 0.75)));
    doc.setTextColor(...GREY);
    doc.text(String(starts[i]), M + W, y + lh(tocSize) * 0.75, { align: "right" });
    doc.link(M, y, W, h, { pageNumber: starts[i] });
    y += h + 1.2;
  });

  // ---------------------------------------------------------------- page numbers
  const total = doc.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(`Pugdundee Safaris SOP - version ${input.version}`, M, PAGE_H - 9);
    doc.text(`Page ${p} of ${total}`, PAGE_W - M, PAGE_H - 9, { align: "right" });
  }
  return doc;
}

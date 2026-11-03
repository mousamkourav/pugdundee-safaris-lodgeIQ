// Word (.docx) -> a flat list of blocks: paragraphs (with style, list level, bold/italic/links),
// tables and images, in reading order. Text boxes (the SOP was made in PowerPoint, so much text
// sits in boxes) come right after the paragraph they are anchored to. The "fallback" copy Word
// keeps of every text box (mc:Fallback) and the shapes' geometry are never read.
import { parseXml, kids, kid, find, findAll, isEl, type XEl } from "./xml";

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  href?: string;
  br?: boolean;
}

export interface ParaBlock {
  kind: "p";
  style: string; // Word style id: Heading2, ListParagraph, BodyText, "" ...
  list?: { level: number; ordered: boolean; numId: string };
  runs: Run[];
  text: string;
  textbox?: boolean; // came from a text box
}
export interface TableCell {
  paras: ParaBlock[];
  colspan: number;
}
export interface TableBlock {
  kind: "table";
  rows: TableCell[][];
}
export interface ImageBlock {
  kind: "image";
  target: string; // "media/image3.png"
  widthPx: number;
  heightPx: number;
  behind: boolean; // drawn behind the text (a page background)
}
export type Block = ParaBlock | TableBlock | ImageBlock;

const SKIP = new Set(["mc:Fallback", "wps:spPr", "wps:style", "wps:bodyPr", "w:sectPr", "w:fldChar", "w:instrText", "w:delText", "w:del"]);
const EMU_PER_PX = 9525;

// rId -> target ("media/image1.png", "http://...")
export function readRels(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!xml) return out;
  for (const r of findAll(parseXml(xml), "Relationship")) if (r.attrs.Id) out.set(r.attrs.Id, r.attrs.Target ?? "");
  return out;
}

// numId -> level -> ordered? (from numbering.xml: a level whose format is not "bullet")
export function readNumbering(xml: string): (numId: string, level: number) => boolean {
  if (!xml) return () => false;
  const root = parseXml(xml);
  const abstract = new Map<string, Map<number, string>>();
  for (const a of findAll(root, "w:abstractNum")) {
    const lv = new Map<number, string>();
    for (const l of kids(a, "w:lvl")) lv.set(Number(l.attrs["w:ilvl"] ?? 0), kid(l, "w:numFmt")?.attrs["w:val"] ?? "bullet");
    abstract.set(a.attrs["w:abstractNumId"], lv);
  }
  const nums = new Map<string, string>();
  for (const n of findAll(root, "w:num")) nums.set(n.attrs["w:numId"], kid(n, "w:abstractNumId")?.attrs["w:val"] ?? "");
  return (numId, level) => {
    const fmt = abstract.get(nums.get(numId) ?? "")?.get(level) ?? "bullet";
    return fmt !== "bullet" && fmt !== "none";
  };
}

const on = (e: XEl | undefined) => !!e && !["0", "false", "none"].includes(e.attrs["w:val"] ?? "");

export function parseDocument(documentXml: string, relsXml = "", numberingXml = ""): Block[] {
  const rels = readRels(relsXml);
  const ordered = readNumbering(numberingXml);
  const root = parseXml(documentXml, SKIP);
  const body = find(root, "w:body");
  if (!body) return [];
  const out: Block[] = [];
  walkBody(body, out, false);
  return out;

  function walkBody(parent: XEl, acc: Block[], textbox: boolean) {
    for (const c of parent.children) {
      if (!isEl(c)) continue;
      if (c.name === "w:p") paragraph(c, acc, textbox);
      else if (c.name === "w:tbl") acc.push(table(c));
      else if (c.name === "w:sdt") {
        const content = kid(c, "w:sdtContent");
        if (content) walkBody(content, acc, textbox);
      } else if (c.name === "w:customXml" || c.name === "w:ins") walkBody(c, acc, textbox);
    }
  }

  function paragraph(p: XEl, acc: Block[], textbox: boolean) {
    const pPr = kid(p, "w:pPr");
    const style = kid(pPr, "w:pStyle")?.attrs["w:val"] ?? "";
    const numPr = kid(pPr, "w:numPr");
    const numId = kid(numPr, "w:numId")?.attrs["w:val"];
    const level = Number(kid(numPr, "w:ilvl")?.attrs["w:val"] ?? 0);
    const runs: Run[] = [];
    const after: Block[] = []; // text boxes and images anchored in this paragraph
    inline(p, runs, after, undefined);
    const text = runs.map((r) => (r.br ? "\n" : r.text)).join("");
    const block: ParaBlock = { kind: "p", style, runs, text };
    if (numId && numId !== "0") block.list = { level, ordered: ordered(numId, level), numId };
    if (textbox) block.textbox = true;
    acc.push(block, ...after);
  }

  function inline(e: XEl, runs: Run[], after: Block[], href: string | undefined) {
    for (const c of e.children) {
      if (!isEl(c)) continue;
      switch (c.name) {
        case "w:r":
          run(c, runs, after, href);
          break;
        case "w:hyperlink": {
          const target = c.attrs["r:id"] ? rels.get(c.attrs["r:id"]) : undefined;
          inline(c, runs, after, target && /^(https?:|mailto:)/i.test(target) ? target : href);
          break;
        }
        case "w:smartTag":
        case "w:ins":
        case "w:fldSimple":
        case "w:customXml":
          inline(c, runs, after, href);
          break;
        case "mc:AlternateContent":
          drawing(kid(c, "mc:Choice") ?? c, after);
          break;
      }
    }
  }

  function run(r: XEl, runs: Run[], after: Block[], href: string | undefined) {
    const rPr = kid(r, "w:rPr");
    const fmt = { bold: on(kid(rPr, "w:b")), italic: on(kid(rPr, "w:i")), underline: on(kid(rPr, "w:u")) };
    for (const c of r.children) {
      if (!isEl(c)) continue;
      if (c.name === "w:t") {
        const t = c.children.filter((x): x is string => typeof x === "string").join("");
        if (t) runs.push({ text: t, ...trim(fmt), ...(href ? { href } : {}) });
      } else if (c.name === "w:tab") runs.push({ text: " " });
      else if (c.name === "w:br" || c.name === "w:cr") {
        if (c.attrs["w:type"] !== "page" && c.attrs["w:type"] !== "column") runs.push({ text: "", br: true });
      } else if (c.name === "w:noBreakHyphen") runs.push({ text: "-" });
      else if (c.name === "w:sym") runs.push({ text: "" });
      else if (c.name === "w:drawing" || c.name === "w:pict") drawing(c, after);
      else if (c.name === "mc:AlternateContent") drawing(kid(c, "mc:Choice") ?? c, after);
    }
  }

  function drawing(d: XEl, after: Block[]) {
    // text boxes: their paragraphs and tables, in order
    for (const box of findAll(d, "w:txbxContent")) walkBody(box, after, true);
    // pictures
    for (const holder of [...findAll(d, "wp:inline"), ...findAll(d, "wp:anchor")]) {
      const blip = findOutsideBoxes(holder, "a:blip"); // a picture inside a text box is read with the box
      const id = blip?.attrs["r:embed"];
      const target = id ? rels.get(id) : undefined;
      if (!target) continue;
      const ext = kid(holder, "wp:extent");
      after.push({
        kind: "image",
        target,
        widthPx: Math.round(Number(ext?.attrs.cx ?? 0) / EMU_PER_PX),
        heightPx: Math.round(Number(ext?.attrs.cy ?? 0) / EMU_PER_PX),
        behind: holder.name === "wp:anchor" && holder.attrs.behindDoc === "1",
      });
    }
  }

  function table(t: XEl): TableBlock {
    const rows: TableCell[][] = [];
    for (const tr of kids(t, "w:tr")) {
      const row: TableCell[] = [];
      for (const tc of kids(tr, "w:tc")) {
        const tcPr = kid(tc, "w:tcPr");
        const span = Number(kid(tcPr, "w:gridSpan")?.attrs["w:val"] ?? 1) || 1;
        const vMerge = kid(tcPr, "w:vMerge");
        const paras: Block[] = [];
        // a cell merged with the one above keeps its place, empty
        if (!(vMerge && vMerge.attrs["w:val"] !== "restart")) walkBody(tc, paras, false);
        row.push({ paras: paras.flatMap((b) => (b.kind === "p" ? [b] : b.kind === "table" ? flattenTable(b) : [])), colspan: span });
      }
      if (row.length) rows.push(row);
    }
    return { kind: "table", rows };
  }
}

function findOutsideBoxes(e: XEl, name: string): XEl | undefined {
  for (const c of e.children) {
    if (!isEl(c) || c.name === "w:txbxContent") continue;
    if (c.name === name) return c;
    const f = findOutsideBoxes(c, name);
    if (f) return f;
  }
  return undefined;
}

// A table inside a table cell: its rows as plain paragraphs.
function flattenTable(t: TableBlock): ParaBlock[] {
  return t.rows.map((r) => {
    const text = r.map((c) => c.paras.map((p) => p.text).join(" ")).join(" | ");
    return { kind: "p", style: "", runs: [{ text }], text };
  });
}

function trim(f: { bold: boolean; italic: boolean; underline: boolean }) {
  const o: { bold?: boolean; italic?: boolean; underline?: boolean } = {};
  if (f.bold) o.bold = true;
  if (f.italic) o.italic = true;
  if (f.underline) o.underline = true;
  return o;
}

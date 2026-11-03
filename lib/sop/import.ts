// SOP import: the owner's Word file (converted from PowerPoint) -> clean sections.
//
// 1. cleanBlocks: drops the slide footers repeated on every slide ("2007", "2024", "2026",
//    "www.pugdundeesafaris.com") and empty lines; where the conversion mixed a footer INTO a line
//    of text ("2th0e0s7ame.") the footer's letters are taken out and the line is flagged to check;
//    drops slide numbers in boxes ("01") and decorative pictures (page backgrounds, tiny icons,
//    a picture repeated on many slides).
// 2. candidates: the lines that may start a section, each with the default: a section code
//    ("A-1", "A - 11", "B- 5", "SOP - Maintenance & more C-1 ...") or "Training:" starts one;
//    "B - 5 (a)" and "Procedure:" stay sub-headings inside it. The preview lets the owner change any.
// 3. buildSections: the sections, each with its body as editor JSON (headings, paragraphs, bold /
//    italic / links, bullet and numbered lists, tables, pictures), and what to check.
import type { Block, ParaBlock, Run, TableBlock } from "./docx";
import type { Doc, Mark, PMNode } from "./types";

export const FOOTER_LINES = ["2007", "2024", "2026", "www.pugdundeesafaris.com"];
const norm = (t: string) => t.replace(/\s+/g, " ").trim();
const footerKey = (t: string) => norm(t).toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
export const isFooter = (t: string) => FOOTER_LINES.includes(footerKey(t));

// The conversion sometimes mixed a footer INTO the last line of a slide, letter by letter:
// "2th0e0s7ame." (2007 + "the same."), "towards gwrewatwSE.pRuVgICdE..." (the web address).
// Returns the text with the footer's letters taken out, or null when it is not there.
// A short footer (a year) must sit inside one word; the web address (long, so never by chance)
// may cross spaces but must end the line. The tightest match is taken.
export function untangle(text: string, token: string): string | null {
  if (text.includes(token)) return null; // written out whole: real text (a link, a year)
  const long = token.length >= 10;
  const maxSpan = Math.ceil(token.length * (long ? 3 : 2.5));
  let best: number[] | null = null;
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== token[0]) continue;
    const picked = [start];
    for (let i = start + 1, k = 1; k < token.length && i < text.length; i++) {
      if (!long && /\s/.test(text[i])) break;
      if (i - start >= maxSpan) break;
      if (text[i] === token[k]) {
        picked.push(i);
        k++;
      }
    }
    if (picked.length !== token.length) continue;
    const span = picked[picked.length - 1] - start + 1;
    if (span <= token.length) continue; // contiguous: real text
    if (long && text.length - 1 - picked[picked.length - 1] > 12) continue;
    if (!best || span < best[best.length - 1] - best[0] + 1) best = picked;
  }
  if (!best) return null;
  const drop = new Set(best);
  return [...text].filter((_, n) => !drop.has(n)).join("");
}

export interface CleanStats {
  footers: number;
  empty: number;
  slideNumbers: number;
  garbled: number;
  imagesKept: number;
  imagesDropped: number;
}
export interface Cleaned {
  blocks: Block[];
  garbled: Set<number>; // indexes in blocks of lines repaired: to check
  stats: CleanStats;
}

const BULLET_RE = /^\s*[\u00b7\u2022\uf0b7\u25cf\u25aa\u25e6\u2043\u2219]\s*(?=\S)|^\s*[-\u2013]\s*(?=[A-Za-z])/;

// Rewrites a paragraph's runs to new text, keeping each run's formatting where it can.
function withText(p: ParaBlock, text: string): ParaBlock {
  return { ...p, text, runs: [{ ...(p.runs.find((r) => r.text.trim()) ?? { text: "" }), text, br: undefined }] };
}

export function cleanBlocks(raw: Block[]): Cleaned {
  const stats: CleanStats = { footers: 0, empty: 0, slideNumbers: 0, garbled: 0, imagesKept: 0, imagesDropped: 0 };
  const uses = new Map<string, number>();
  for (const b of raw) if (b.kind === "image") uses.set(b.target, (uses.get(b.target) ?? 0) + 1);
  const blocks: Block[] = [];
  const garbled = new Set<number>();
  const cleanPara = (p: ParaBlock): ParaBlock | null => {
    const runs = p.runs.map((r) => (r.br ? r : { ...r, text: r.text.replace(/[\u00a0\u2007\u202f]/g, " ").replace(/[ \t]+/g, " ") }));
    let text = runs.map((r) => (r.br ? "\n" : r.text)).join("");
    if (isFooter(text)) {
      stats.footers++;
      return null;
    }
    if (!text.trim()) {
      stats.empty++;
      return null;
    }
    if (p.textbox && /^\s*\d{1,2}\s*$/.test(text)) {
      stats.slideNumbers++;
      return null;
    }
    let out: ParaBlock = { ...p, runs, text };
    for (const f of FOOTER_LINES) {
      const fixed = untangle(text, f);
      if (fixed != null) {
        text = norm(fixed);
        out = withText(out, text);
        (out as ParaBlock & { garbled?: boolean }).garbled = true;
      }
    }
    return out;
  };
  for (const b of raw) {
    if (b.kind === "p") {
      const p = cleanPara(b);
      if (!p) continue;
      if ((p as ParaBlock & { garbled?: boolean }).garbled) {
        stats.garbled++;
        garbled.add(blocks.length);
      }
      blocks.push(p);
    } else if (b.kind === "image") {
      const decorative = b.behind || b.widthPx < 64 || b.heightPx < 64 || (uses.get(b.target) ?? 0) >= 5;
      if (decorative) stats.imagesDropped++;
      else {
        stats.imagesKept++;
        blocks.push(b);
      }
    } else {
      const rows = b.rows
        .map((r) => r.map((c) => ({ ...c, paras: c.paras.map(cleanPara).filter((x): x is ParaBlock => !!x) })))
        .filter((r) => r.some((c) => c.paras.length));
      if (rows.length) blocks.push({ kind: "table", rows });
    }
  }
  return { blocks, garbled, stats };
}

// ---------------------------------------------------------------- where sections start

const CODE_RE = /([A-F])\s*[\u2013\u2014-]\s*(\d{1,2})(?!\d)\s*\.?/;
const PART_RE = /^SOP\s*[\u2013\u2014-]\s*/i;
const SUBHEAD_RE = /^(procedure|training)\s*:?$/i;
const isHeadingStyle = (s: string) => /^(heading\d|title)$/i.test(s);

export interface SectionStart {
  code: string | null; // "A-1"
  title: string; // "A-1 GUEST CHECK-IN AT LODGE AND PRIOR"
  part: string | null; // "SOP \u2013 Maintenance & more", written before the code on the same line
  sub: string | null; // the rest of the line that is a sub-heading: "B \u2013 5 (a) Personal Hygiene", "Procedure:"
}

const tidyTitle = (t: string) => norm(t).replace(/[\s:;.,\u2013-]+$/, "").trim();

// The section that this line starts (by the default rules), or null.
export function sectionStart(b: Block): SectionStart | null {
  if (b.kind !== "p" || b.textbox) return null;
  const t = norm(b.text.replace(BULLET_RE, ""));
  if (!t || t.length > 160) return null;
  if (isHeadingStyle(b.style) && /^training\s*:$/i.test(t)) return { code: null, title: "Training", part: null, sub: null };
  const m = CODE_RE.exec(t);
  if (!m) return null;
  let part: string | null = null;
  if (m.index > 0) {
    if (!PART_RE.test(t) || m.index > 60) return null;
    part = tidyTitle(t.slice(0, m.index));
  }
  let rest = t.slice(m.index + m[0].length);
  if (/^\s*\([a-z]\)/i.test(rest)) return null; // "B \u2013 5 (b) ...": a sub-part
  const code = `${m[1]}-${m[2]}`;
  let sub: string | null = null;
  const again = CODE_RE.exec(rest); // "B \u2013 5 Kitchen upkeep (TRAINING) B \u2013 5 (a) Personal Hygiene"
  if (again) {
    sub = norm(rest.slice(again.index));
    rest = rest.slice(0, again.index);
  } else {
    const colon = rest.indexOf(":");
    if (colon >= 0 && SUBHEAD_RE.test(norm(rest.slice(colon + 1)))) {
      sub = norm(rest.slice(colon + 1));
      rest = rest.slice(0, colon);
    }
  }
  const name = tidyTitle(rest);
  return { code, title: name ? `${code} ${name}` : code, part, sub };
}

// A short heading right before a section ("SOP - Lodge Operations", "General Tips"): the title of
// the part that section opens. It goes to the top of that section, not the end of the one before.
function isPartHeading(b: Block | undefined): b is ParaBlock {
  if (!b || b.kind !== "p" || b.textbox || b.list) return false;
  const t = norm(b.text);
  return t.length > 0 && t.length <= 70 && (isHeadingStyle(b.style) || PART_RE.test(t)) && !CODE_RE.test(t);
}

export interface Candidate {
  index: number; // in the cleaned blocks
  text: string;
  split: boolean; // the default
}

// Every line the owner may want to start a section at: headings and lines with a section code.
export function candidates(blocks: Block[]): Candidate[] {
  const out: Candidate[] = [];
  blocks.forEach((b, index) => {
    if (b.kind !== "p" || b.textbox) return;
    const start = sectionStart(b);
    if (start || isHeadingStyle(b.style)) out.push({ index, text: norm(b.text).slice(0, 160), split: !!start });
  });
  return out;
}

// ---------------------------------------------------------------- editor JSON

export interface ImportSection {
  title: string;
  code: string | null;
  start: number; // block index of its first line (-1 = the introduction)
  body: Doc;
  warnings: string[];
  counts: { paragraphs: number; lists: number; tables: number; images: number; textBoxLines: number };
}

const headingLevel = (style: string) => (/^heading([3-9])$/i.test(style) ? 4 : 3);

function textNodes(runs: Run[], stripBullet: boolean): PMNode[] {
  const out: PMNode[] = [];
  let first = true;
  for (const r of runs) {
    if (r.br) {
      out.push({ type: "hardBreak" });
      continue;
    }
    let text = r.text;
    if (first && text.trim()) {
      text = text.replace(/^\s+/, "");
      if (stripBullet) text = text.replace(BULLET_RE, "");
      first = false;
    } else if (first) continue;
    if (!text) continue;
    const marks: Mark[] = [];
    if (r.bold) marks.push({ type: "bold" });
    if (r.italic) marks.push({ type: "italic" });
    if (r.underline && !r.href) marks.push({ type: "underline" });
    if (r.href) marks.push({ type: "link", attrs: { href: r.href } });
    const prev = out[out.length - 1];
    if (prev?.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(marks)) prev.text += text;
    else out.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
  }
  // trailing spaces and line breaks
  while (out.length && out[out.length - 1].type === "hardBreak") out.pop();
  const last = out[out.length - 1];
  if (last?.type === "text") {
    last.text = last.text!.replace(/\s+$/, "");
    if (!last.text) out.pop();
  }
  return out;
}

const paragraphNode = (p: ParaBlock, stripBullet = false): PMNode => {
  const content = textNodes(p.runs, stripBullet);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

function tableNode(t: TableBlock): PMNode {
  return {
    type: "table",
    content: t.rows.map((r) => ({
      type: "tableRow",
      content: r.map((c) => ({
        type: "tableCell",
        attrs: { colspan: c.colspan, rowspan: 1, colwidth: null },
        content: c.paras.length ? c.paras.map((p) => paragraphNode(p, false)) : [{ type: "paragraph" }],
      })),
    })),
  };
}

// Blocks -> editor nodes. Consecutive list lines become one list (nested by their Word level);
// "*" / "-" lines are bullets too.
export function blocksToDoc(blocks: Block[], imageSrc: (target: string) => string | null): Doc {
  const out: PMNode[] = [];
  let stack: { level: number; ordered: boolean; list: PMNode }[] = [];
  const asItem = (b: Block): { level: number; ordered: boolean } | null => {
    if (b.kind !== "p" || isHeadingStyle(b.style)) return null;
    if (b.list) return { level: b.list.level, ordered: b.list.ordered };
    if (BULLET_RE.test(b.text)) return { level: 0, ordered: false };
    return null;
  };
  for (const b of blocks) {
    const item = asItem(b);
    if (!item) {
      stack = [];
      if (b.kind === "p") {
        if (isHeadingStyle(b.style) && !b.textbox) {
          const content = textNodes(b.runs, true).map((n) => (n.type === "text" ? { ...n, marks: (n.marks ?? []).filter((m) => m.type !== "bold") } : n));
          out.push({ type: "heading", attrs: { level: headingLevel(b.style) }, content: content.map((n) => (n.marks && !n.marks.length ? { type: n.type, text: n.text } : n)) });
        } else out.push(paragraphNode(b));
      } else if (b.kind === "table") out.push(tableNode(b));
      else {
        const src = imageSrc(b.target);
        if (src) out.push({ type: "image", attrs: { src, alt: "" } });
      }
      continue;
    }
    const li: PMNode = { type: "listItem", content: [paragraphNode(b as ParaBlock, true)] };
    while (stack.length && stack[stack.length - 1].level > item.level) stack.pop();
    if (stack.length && stack[stack.length - 1].level === item.level && stack[stack.length - 1].ordered !== item.ordered) stack.pop();
    const top = stack[stack.length - 1];
    if (!top || top.level < item.level) {
      const list: PMNode = { type: item.ordered ? "orderedList" : "bulletList", content: [] };
      if (item.ordered) list.attrs = { start: 1 };
      if (!top) out.push(list);
      else {
        const lastItem = top.list.content![top.list.content!.length - 1];
        lastItem.content!.push(list);
      }
      stack.push({ level: item.level, ordered: item.ordered, list });
    }
    stack[stack.length - 1].list.content!.push(li);
  }
  // headings left empty by the clean-up
  const content = out.filter((n) => n.type !== "heading" || (n.content ?? []).length);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

const subHeading = (text: string): ParaBlock => ({ kind: "p", style: "Heading2", runs: [{ text }], text });

export function buildSections(cleaned: Cleaned, splits: Record<number, boolean> = {}, imageSrc: (target: string) => string | null = () => null): ImportSection[] {
  const { blocks, garbled } = cleaned;
  const starts: number[] = [];
  const startInfo = new Map<number, SectionStart>();
  blocks.forEach((b, i) => {
    const def = sectionStart(b);
    const on = splits[i] ?? !!def;
    if (!on || b.kind !== "p") return;
    starts.push(i);
    startInfo.set(i, def ?? { code: null, title: tidyTitle(b.text.replace(BULLET_RE, "")) || "Section", part: null, sub: null });
  });
  // a part heading right before a start moves into that section
  const movedPart = new Set<number>();
  for (const s of starts) if (s > 0 && !startInfo.has(s - 1) && isPartHeading(blocks[s - 1])) movedPart.add(s - 1);

  const sections: ImportSection[] = [];
  const make = (title: string, code: string | null, start: number, body: Block[], indexes: number[]) => {
    const warnings: string[] = [];
    const bad = indexes.filter((i) => garbled.has(i));
    for (const i of bad) {
      const b = blocks[i];
      if (b.kind === "p") warnings.push(`Check this line (the slide footer was mixed into it): "${norm(b.text).slice(0, 80)}"`);
    }
    const tb = body.filter((b) => b.kind === "p" && b.textbox).length;
    if (tb >= 3) warnings.push(`${tb} lines came from boxes on the slide (columns, call-outs): check the layout; a table may need rebuilding.`);
    const doc = blocksToDoc(body, imageSrc);
    const count = (t: string) => doc.content.filter((n) => n.type === t).length;
    sections.push({
      title,
      code,
      start,
      body: doc,
      warnings,
      counts: {
        paragraphs: body.filter((b) => b.kind === "p").length,
        lists: count("bulletList") + count("orderedList"),
        tables: count("table"),
        images: count("image"),
        textBoxLines: tb,
      },
    });
  };

  const first = starts.length ? starts[0] : blocks.length;
  const introIdx = [...Array(first).keys()].filter((i) => !movedPart.has(i));
  if (introIdx.length) make("Introduction", null, -1, introIdx.map((i) => blocks[i]), introIdx);

  starts.forEach((s, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : blocks.length;
    const info = startInfo.get(s)!;
    const head: Block[] = [];
    const idx: number[] = [];
    if (movedPart.has(s - 1)) {
      head.push(subHeading(norm((blocks[s - 1] as ParaBlock).text)));
      idx.push(s - 1);
    }
    if (info.part) head.push(subHeading(info.part));
    if (info.sub) head.push(subHeading(info.sub));
    const rest: number[] = [];
    for (let i = s + 1; i < end; i++) if (!movedPart.has(i)) rest.push(i);
    make(info.title, info.code, s, [...head, ...rest.map((i) => blocks[i])], [s, ...idx, ...rest]);
  });
  return sections;
}

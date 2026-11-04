// SOP section bodies: cleaned on the server before saving (sanitizeDoc), turned into plain text
// (search, "what changed") and HTML (sop_sections.body_html), compared between versions, and
// searched with highlighted snippets.
import type { Doc, Mark, MarkType, PMNode, SectionText } from "./types";

// Pictures are always ours, served through the access-checked route /sop/media/...
export const MEDIA_SRC_RE = /^\/sop\/media\/images\/[A-Za-z0-9_-]+\.(png|jpe?g|gif|webp)$/;
const LINK_RE = /^(https?:\/\/|mailto:|tel:)[^\s"<>]+$/i;
const MAX_NODES = 60_000;
const MAX_TEXT = 20_000;

const BLOCKS = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "horizontalRule", "table", "tableRow", "tableCell", "tableHeader", "image", "hardBreak", "text"]);
const MARKS = new Set<MarkType>(["bold", "italic", "underline", "strike", "link"]);
// which children each node may hold (light structure checks; the editor makes valid trees)
const CHILDREN: Record<string, (t: string) => boolean> = {
  doc: (t) => ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "horizontalRule", "table", "image"].includes(t),
  paragraph: (t) => t === "text" || t === "hardBreak" || t === "image",
  heading: (t) => t === "text" || t === "hardBreak",
  bulletList: (t) => t === "listItem",
  orderedList: (t) => t === "listItem",
  listItem: (t) => ["paragraph", "heading", "bulletList", "orderedList", "image"].includes(t),
  blockquote: (t) => ["paragraph", "heading", "bulletList", "orderedList"].includes(t),
  table: (t) => t === "tableRow",
  tableRow: (t) => t === "tableCell" || t === "tableHeader",
  tableCell: (t) => ["paragraph", "heading", "bulletList", "orderedList", "image"].includes(t),
  tableHeader: (t) => ["paragraph", "heading", "bulletList", "orderedList", "image"].includes(t),
};

const int = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
};

// Only what the editor can make: known nodes and marks, safe links, our own pictures.
// Anything else is dropped. Throws when the content is far too large.
export function sanitizeDoc(input: unknown): Doc {
  let count = 0;
  const marks = (ms: unknown): Mark[] | undefined => {
    if (!Array.isArray(ms)) return undefined;
    const out: Mark[] = [];
    for (const m of ms) {
      const type = (m as Mark)?.type;
      if (!MARKS.has(type) || out.some((x) => x.type === type)) continue;
      if (type === "link") {
        const href = String((m as Mark).attrs?.href ?? "").trim();
        if (LINK_RE.test(href)) out.push({ type, attrs: { href } });
      } else out.push({ type });
    }
    return out.length ? out : undefined;
  };
  const node = (n: unknown, parent: string, depth: number): PMNode | null => {
    if (!n || typeof n !== "object" || depth > 24) return null;
    if (++count > MAX_NODES) throw new Error("This section is too long. Split it into two sections.");
    const src = n as PMNode;
    const type = String(src.type ?? "");
    if (!BLOCKS.has(type) || !CHILDREN[parent]?.(type)) return null;
    if (type === "text") {
      const text = typeof src.text === "string" ? src.text.slice(0, MAX_TEXT) : "";
      if (!text) return null;
      const m = marks(src.marks);
      return m ? { type, text, marks: m } : { type, text };
    }
    if (type === "hardBreak" || type === "horizontalRule") return { type };
    if (type === "image") {
      const s = String(src.attrs?.src ?? "");
      if (!MEDIA_SRC_RE.test(s)) return null;
      return { type, attrs: { src: s, alt: String(src.attrs?.alt ?? "").slice(0, 200) } };
    }
    const out: PMNode = { type };
    if (type === "heading") out.attrs = { level: int(src.attrs?.level, 2, 4, 3) };
    if (type === "orderedList") out.attrs = { start: int(src.attrs?.start, 1, 9999, 1) };
    if (type === "tableCell" || type === "tableHeader") {
      const cw = src.attrs?.colwidth;
      out.attrs = {
        colspan: int(src.attrs?.colspan, 1, 30, 1),
        rowspan: int(src.attrs?.rowspan, 1, 200, 1),
        colwidth: Array.isArray(cw) && cw.every((x) => Number.isInteger(x) && x > 0 && x < 5000) ? cw : null,
      };
    }
    const content = (Array.isArray(src.content) ? src.content : []).map((c) => node(c, type, depth + 1)).filter((c): c is PMNode => !!c);
    // containers that must not be empty
    if (["bulletList", "orderedList", "table", "tableRow"].includes(type) && !content.length) return null;
    if (["listItem", "tableCell", "tableHeader", "blockquote"].includes(type) && !content.length) content.push({ type: "paragraph" });
    if (content.length) out.content = content;
    return out;
  };
  const src = input as Doc | null;
  if (!src || typeof src !== "object" || src.type !== "doc") return { type: "doc", content: [{ type: "paragraph" }] };
  const content = (Array.isArray(src.content) ? src.content : []).map((c) => node(c, "doc", 0)).filter((c): c is PMNode => !!c);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

// Plain text: one line per paragraph, list item and table row.
export function docText(doc: Doc): string {
  const lines: string[] = [];
  const inline = (n: PMNode): string => (n.type === "text" ? n.text ?? "" : n.type === "hardBreak" ? " " : (n.content ?? []).map(inline).join(""));
  const walk = (n: PMNode) => {
    if (n.type === "paragraph" || n.type === "heading") {
      const t = inline(n).trim();
      if (t) lines.push(t);
    } else if (n.type === "tableRow") {
      const t = (n.content ?? []).map((c) => (c.content ?? []).map(inline).join(" ").trim()).join(" | ");
      if (t.replace(/[|\s]/g, "")) lines.push(t);
    } else (n.content ?? []).forEach(walk);
  };
  doc.content.forEach(walk);
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// HTML for storage / export. Everything is escaped; only the sanitised structure is written.
export function docHtml(doc: Doc): string {
  const markTag: Record<string, [string, string]> = { bold: ["<strong>", "</strong>"], italic: ["<em>", "</em>"], underline: ["<u>", "</u>"], strike: ["<s>", "</s>"] };
  const node = (n: PMNode): string => {
    const inner = () => (n.content ?? []).map(node).join("");
    switch (n.type) {
      case "text": {
        let t = esc(n.text ?? "");
        for (const m of n.marks ?? []) {
          if (m.type === "link") t = `<a href="${esc(m.attrs?.href ?? "")}" rel="noopener noreferrer">${t}</a>`;
          else t = markTag[m.type][0] + t + markTag[m.type][1];
        }
        return t;
      }
      case "hardBreak":
        return "<br>";
      case "horizontalRule":
        return "<hr>";
      case "paragraph":
        return `<p>${inner()}</p>`;
      case "heading": {
        const l = int(n.attrs?.level, 2, 4, 3);
        return `<h${l}>${inner()}</h${l}>`;
      }
      case "bulletList":
        return `<ul>${inner()}</ul>`;
      case "orderedList":
        return `<ol>${inner()}</ol>`;
      case "listItem":
        return `<li>${inner()}</li>`;
      case "blockquote":
        return `<blockquote>${inner()}</blockquote>`;
      case "table":
        return `<table>${inner()}</table>`;
      case "tableRow":
        return `<tr>${inner()}</tr>`;
      case "tableCell":
      case "tableHeader": {
        const tag = n.type === "tableHeader" ? "th" : "td";
        const span = int(n.attrs?.colspan, 1, 30, 1);
        return `<${tag}${span > 1 ? ` colspan="${span}"` : ""}>${inner()}</${tag}>`;
      }
      case "image":
        return `<img src="${esc(String(n.attrs?.src ?? ""))}" alt="${esc(String(n.attrs?.alt ?? ""))}">`;
      default:
        return inner();
    }
  };
  return doc.content.map(node).join("");
}

// ---------------------------------------------------------------- what changed between versions

export interface VersionDiff {
  added: string[];
  removed: string[];
  edited: string[]; // text changed (title as now)
  renamed: { from: string; to: string }[];
  moved: string[];
}

// Sections are followed by their id: a section keeps its id when edited, renamed or moved.
export function diffSections(before: SectionText[], after: SectionText[]): VersionDiff {
  const old = new Map(before.map((s) => [s.id, s]));
  const now = new Map(after.map((s) => [s.id, s]));
  const d: VersionDiff = { added: [], removed: [], edited: [], renamed: [], moved: [] };
  for (const s of after) {
    const o = old.get(s.id);
    if (!o) {
      d.added.push(s.title);
      continue;
    }
    if (o.title !== s.title) d.renamed.push({ from: o.title, to: s.title });
    if (o.text !== s.text) d.edited.push(s.title);
  }
  for (const s of before) if (!now.has(s.id)) d.removed.push(s.title);
  // moved: the order of the sections both have, compared
  const keptBefore = before.filter((s) => now.has(s.id)).map((s) => s.id);
  const keptAfter = after.filter((s) => old.has(s.id)).map((s) => s.id);
  const posBefore = new Map(keptBefore.map((id, i) => [id, i]));
  keptAfter.forEach((id, i) => {
    // a section moved when the sections around it are no longer the same
    const prevSame = i === 0 ? posBefore.get(id) === 0 : posBefore.get(keptAfter[i - 1]) === posBefore.get(id)! - 1;
    const nextSame = i === keptAfter.length - 1 ? posBefore.get(id) === keptBefore.length - 1 : posBefore.get(keptAfter[i + 1]) === posBefore.get(id)! + 1;
    if (!prevSame && !nextSame) d.moved.push(now.get(id)!.title);
  });
  return d;
}

export const diffIsEmpty = (d: VersionDiff) => !d.added.length && !d.removed.length && !d.edited.length && !d.renamed.length && !d.moved.length;

// ---------------------------------------------------------------- search

export interface SearchHit {
  id: string;
  title: string;
  count: number;
  snippets: string[]; // plain text around each match (the page highlights the words)
}

// Words of the query (2+ letters); a section matches when it has every word (title or text).
export function queryWords(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2))].slice(0, 8);
}

export function searchSections(sections: SectionText[], q: string, maxSnippets = 3): SearchHit[] {
  const words = queryWords(q);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const s of sections) {
    const hay = `${s.title}\n${s.text}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    let count = 0;
    for (const w of words) for (let i = hay.indexOf(w); i >= 0; i = hay.indexOf(w, i + w.length)) count++;
    const snippets: string[] = [];
    for (const line of s.text.split("\n")) {
      if (snippets.length >= maxSnippets) break;
      const low = line.toLowerCase();
      const at = words.map((w) => low.indexOf(w)).filter((i) => i >= 0);
      if (!at.length) continue;
      const first = Math.min(...at);
      const from = Math.max(0, first - 60);
      const to = Math.min(line.length, first + 140);
      snippets.push(`${from > 0 ? "..." : ""}${line.slice(from, to)}${to < line.length ? "..." : ""}`);
    }
    hits.push({ id: s.id, title: s.title, count, snippets });
  }
  return hits.sort((a, b) => b.count - a.count);
}

// Splits text into plain and highlighted parts (case-insensitive), for the read view.
export function highlightParts(text: string, words: string[]): { text: string; hit: boolean }[] {
  if (!words.length || !text) return [{ text, hit: false }];
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

// ---------------------------------------------------------------- draft rows

export interface DraftRow {
  id?: string;
  title: string;
  body_json: Doc;
  body_html: string;
  body_text: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

// Sections (from the import, or an old version being restored) -> cleaned draft rows, in order.
// A restored section keeps its id, so "what changed" still follows it; an imported one gets new.
export function toDraftRows(sections: { id?: unknown; title?: unknown; body?: unknown }[]): DraftRow[] {
  if (!Array.isArray(sections) || !sections.length) throw new Error("No sections.");
  if (sections.length > 500) throw new Error("Too many sections (500 at most).");
  const seen = new Set<string>();
  return sections.map((s, i) => {
    const title = String(s?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || `Section ${i + 1}`;
    const body = sanitizeDoc(s?.body);
    const id = isUuid(s?.id) && !seen.has(s.id) ? s.id : undefined;
    if (id) seen.add(id);
    return { ...(id ? { id } : {}), title, body_json: body, body_html: docHtml(body), body_text: docText(body) };
  });
}

// The rows of an import: cleaned like any section, always NEW sections (no ids kept).
export function importRows(sections: { title?: unknown; body?: unknown }[]): Omit<DraftRow, "id">[] {
  return toDraftRows(sections).map((r) => {
    const rest = { ...r };
    delete rest.id;
    return rest;
  });
}

// A small, forgiving XML reader for Word's XML. It builds a tree of elements and text, and
// jumps over whole subtrees it is told to skip (the SOP's slide shapes are 30,000 points of
// vector geometry inside wps:spPr; the "fallback" copy of every text box is mc:Fallback).

export interface XEl {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
}
export type XNode = XEl | string;

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = decodeEntities(m[3] ?? m[4] ?? "");
  return out;
}

// Index just after the end tag that closes <name ...> opened before `from`.
function skipElement(xml: string, from: number, name: string): number {
  const close = `</${name}>`;
  const open = `<${name}`;
  let depth = 1;
  let i = from;
  while (depth > 0) {
    const c = xml.indexOf(close, i);
    if (c < 0) return xml.length;
    // nested opens of the same name before this close
    let o = xml.indexOf(open, i);
    while (o >= 0 && o < c) {
      const ch = xml[o + open.length];
      if (ch === ">" || ch === " " || ch === "/" || ch === "\t" || ch === "\n" || ch === "\r") {
        const end = xml.indexOf(">", o);
        if (xml[end - 1] !== "/") depth++;
      }
      o = xml.indexOf(open, o + 1);
    }
    depth--;
    i = c + close.length;
  }
  return i;
}

export function parseXml(xml: string, skip: ReadonlySet<string> = new Set()): XEl {
  const root: XEl = { name: "#root", attrs: {}, children: [] };
  const stack: XEl[] = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) {
      const t = xml.slice(i, textEnd);
      const parent = stack[stack.length - 1];
      // a space alone is real text inside Word's text element (<w:t xml:space="preserve"> </w:t>)
      if (t.trim() || parent.name === "w:t") parent.children.push(decodeEntities(t));
    }
    if (lt < 0) break;
    if (xml.startsWith("<!--", lt)) {
      const e = xml.indexOf("-->", lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const e = xml.indexOf("]]>", lt + 9);
      stack[stack.length - 1].children.push(xml.slice(lt + 9, e < 0 ? n : e));
      i = e < 0 ? n : e + 3;
      continue;
    }
    const gt = xml.indexOf(">", lt);
    if (gt < 0) break;
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (raw[0] === "?" || raw[0] === "!") continue;
    if (raw[0] === "/") {
      const name = raw.slice(1).trim();
      // close the matching element (forgiving: also closes any left open inside it)
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const selfClose = raw.endsWith("/");
    const body = selfClose ? raw.slice(0, -1) : raw;
    const sp = body.search(/[\s]/);
    const name = sp < 0 ? body : body.slice(0, sp);
    if (skip.has(name)) {
      if (!selfClose) i = skipElement(xml, i, name);
      continue;
    }
    const el: XEl = { name, attrs: sp < 0 ? {} : parseAttrs(body.slice(sp)), children: [] };
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}

// ---- small helpers for walking the tree
export const isEl = (x: XNode | undefined): x is XEl => typeof x === "object" && x !== null;
export const kids = (e: XEl, name?: string): XEl[] => e.children.filter((c): c is XEl => isEl(c) && (!name || c.name === name));
export const kid = (e: XEl | undefined, name: string): XEl | undefined => (e ? kids(e, name)[0] : undefined);

// First descendant with this name (depth first).
export function find(e: XEl, name: string): XEl | undefined {
  for (const c of e.children) {
    if (!isEl(c)) continue;
    if (c.name === name) return c;
    const f = find(c, name);
    if (f) return f;
  }
  return undefined;
}
export function findAll(e: XEl, name: string, out: XEl[] = []): XEl[] {
  for (const c of e.children) {
    if (!isEl(c)) continue;
    if (c.name === name) out.push(c);
    else findAll(c, name, out);
  }
  return out;
}

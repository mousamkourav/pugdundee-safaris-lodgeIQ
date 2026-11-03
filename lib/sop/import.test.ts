// Run with:  npx tsx --test lib/sop/import.test.ts
//
// Import of the owner's SOP Word file: a small .docx built here with every case the real file
// has (slide footers, a footer mixed into a line, empty lines, section codes in every form,
// "Training", sub-codes, part titles, numbered and "*" lists, a table, text boxes with their
// fallback copy, a page background, tiny icons, a real picture), and the real file itself when
// it is in rate-docs/ (it is not committed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listZip, readDocx, type Inflate } from "./zip";
import { parseDocument } from "./docx";
import { cleanBlocks, buildSections, candidates, sectionStart, untangle, isFooter } from "./import";
import { docText, sanitizeDoc } from "./content";
import type { Doc, PMNode } from "./types";

const inflate: Inflate = async (d) => new Uint8Array(inflateRawSync(d));

// ---------------------------------------------------------------- a tiny zip writer (tests only)
function makeZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === "string" ? enc.encode(content) : content;
    const data = new Uint8Array(deflateRawSync(raw));
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    local.set(data, 30 + n.length);
    const central = new Uint8Array(46 + n.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    central.set(n, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((t, c) => t + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

// ---------------------------------------------------------------- a small SOP in Word's XML
const P = (text: string, style = "", extra = "") =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const NUM = (text: string, numId = "1", lvl = 0) => P(text, "ListParagraph", `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${numId}"/></w:numPr>`);
// one slide's end: the footer lines the PowerPoint conversion repeats
const FOOTER = P("2007") + P("www.pugdundeesafaris.com", "Heading1") + P("", "Heading1") + P("2026");
// a text box (the real content in mc:Choice) and Word's fallback copy of it (never read)
const BOX = (lines: string[]) =>
  `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor behindDoc="0"><wp:extent cx="1000" cy="1000"/><a:graphic><a:graphicData><wps:wsp><wps:spPr><a:custGeom><a:pathLst><a:path><a:pt x="1" y="2"/></a:path></a:pathLst></a:custGeom></wps:spPr><wps:txbx><w:txbxContent>${lines.map((l) => P(l)).join("")}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox><w:txbxContent>${lines.map((l) => P(`FALLBACK ${l}`)).join("")}</w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
const PIC = (rid: string, px: number, behind = false, inline = false) => {
  const ext = `<wp:extent cx="${px * 9525}" cy="${px * 9525}"/>`;
  const g = `<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>`;
  return `<w:p><w:r><w:drawing>${inline ? `<wp:inline>${ext}${g}</wp:inline>` : `<wp:anchor behindDoc="${behind ? 1 : 0}">${ext}${g}</wp:anchor>`}</w:drawing></w:r></w:p>`;
};
const SPACED = `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>A\u20132</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:t>During</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:t>the Stay of Guest:</w:t></w:r></w:p>`;
const BOLD_LINK = `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Call reservations </w:t></w:r><w:hyperlink r:id="rLink"><w:r><w:t>by email</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> today.</w:t></w:r></w:p>`;
const TABLE = `<w:tbl><w:tr><w:tc>${P("Item")}</w:tc><w:tc>${P("Schedule")}</w:tc></w:tr><w:tr><w:tc>${P("Radiator")}</w:tc><w:tc>${P("Every 10 trips")}</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${P("Check daily")}</w:tc></w:tr><w:tr><w:tc>${P("")}</w:tc><w:tc>${P("")}</w:tc></w:tr></w:tbl>`;

const BODY = [
  P("2024"),
  P("Standard Operating Procedure", "Title"),
  P(""),
  P("\u201cA customer is the most important visitor on our premises.\u201d"),
  ...Array.from({ length: 5 }, () => PIC("rBg", 964, true)), // the paper background, behind every slide
  FOOTER,
  P("A\u20131 GUEST CHECK-IN AT LODGE AND PRIOR:"),
  NUM("Call the guest a day prior."),
  NUM("Luggage to be identified.", "1", 1),
  P("\u00b7About our lodge", "BodyText"),
  P("\u00b7Meal timings", "BodyText"),
  P("2th0e0s7ame."), // the footer 2007 mixed into "the same."
  FOOTER,
  P("Training:", "Heading2"),
  P("To make every guest feel welcome."),
  P("Procedure:", "Heading2"),
  NUM("Meet the guests.", "2"),
  PIC("rIcon", 27), // a bullet icon
  SPACED,
  BOLD_LINK,
  PIC("rPhoto", 400, false, true), // a real picture
  P("SOP \u2013 Lodge Operations", "Heading2"),
  P("B \u2013 1 Accounts Procedure at the Lodge:"),
  P("Petty cash daily."),
  P("B \u2013 5 Kitchen upkeep (TRAINING) B \u2013 5 (a) Personal Hygiene", "Heading2"),
  P("Wash hands."),
  P("B \u2013 5 (b) Preparation for Kitchen Service:", "Heading2"),
  P("Clean the counters."),
  P("SOP \u2013 Maintenance &amp; more C\u20131 Gypsy Maintenance:", "Heading2"),
  BOX(["S.NO", "01", "Item", "Radiator"]),
  TABLE,
  P("A -17. Festivals with Guests:", "Heading2"),
  P("Diwali", "Heading2"),
  P("Light diyas."),
  FOOTER,
].join("");

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="w" xmlns:mc="mc" xmlns:wp="wp" xmlns:a="a" xmlns:pic="pic" xmlns:wps="wps" xmlns:v="v" xmlns:r="r"><w:body>${BODY}<w:sectPr/></w:body></w:document>`;
const RELS = `<?xml version="1.0"?><Relationships><Relationship Id="rBg" Type="image" Target="media/image1.png"/><Relationship Id="rIcon" Type="image" Target="media/image3.png"/><Relationship Id="rPhoto" Type="image" Target="media/image9.png"/><Relationship Id="rLink" Type="hyperlink" Target="mailto:reservation@pugdundeesafaris.com" TargetMode="External"/></Relationships>`;
const NUMBERING = `<?xml version="1.0"?><w:numbering><w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="11"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="11"/></w:num></w:numbering>`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0x90, 0, 0, 1, 0x90, 8, 6, 0, 0, 0]);

const docx = makeZip({
  "[Content_Types].xml": "<Types/>",
  "word/document.xml": DOCUMENT,
  "word/_rels/document.xml.rels": RELS,
  "word/numbering.xml": NUMBERING,
  "word/media/image1.png": PNG,
  "word/media/image3.png": PNG,
  "word/media/image9.png": PNG,
});

async function importSmall() {
  const parts = await readDocx(docx, inflate);
  const cleaned = cleanBlocks(parseDocument(parts.document, parts.rels, parts.numbering));
  return { parts, cleaned, sections: buildSections(cleaned, {}, (t) => `/sop/media/images/${t.replace(/\W/g, "_")}.png`) };
}
const all = (d: Doc) => docText(d);
const find = (d: Doc, type: string): PMNode[] => {
  const out: PMNode[] = [];
  const walk = (n: PMNode) => {
    if (n.type === type) out.push(n);
    (n.content ?? []).forEach(walk);
  };
  d.content.forEach(walk);
  return out;
};

// ---------------------------------------------------------------- the zip reader

test("zip: lists and reads the parts of a .docx; a file that is not a zip is refused", async () => {
  assert.deepEqual(listZip(docx).map((e) => e.name).slice(0, 2), ["[Content_Types].xml", "word/document.xml"]);
  const parts = await readDocx(docx, inflate);
  assert.ok(parts.document.includes("GUEST CHECK-IN"));
  assert.deepEqual([...parts.media.keys()].sort(), ["media/image1.png", "media/image3.png", "media/image9.png"]);
  assert.throws(() => listZip(new TextEncoder().encode("not a word file")), /not a Word/);
});

// ---------------------------------------------------------------- clean-up

test("clean-up: the slide footers and empty lines are removed; a footer mixed into a line is taken out and flagged", async () => {
  const { cleaned, sections } = await importSmall();
  const text = sections.map((s) => all(s.body)).join("\n");
  for (const f of ["2007", "2024", "2026", "www.pugdundeesafaris.com"]) assert.ok(!text.split("\n").includes(f), f);
  assert.equal(cleaned.stats.footers, 3 * 3 + 1); // 3 slides x (2007, the address, 2026) + the first "2024"
  assert.ok(cleaned.stats.empty >= 4);
  assert.match(text, /\bthesame\./); // "2th0e0s7ame." without the 2007
  assert.equal(cleaned.stats.garbled, 1);
  assert.ok(sections.find((s) => s.code === "A-1")!.warnings.some((w) => /slide footer was mixed/.test(w)));
});

test("clean-up: untangle finds a footer spread through a word, never a footer written whole", () => {
  assert.equal(untangle("2th0e0s7ame.", "2007"), "thesame.");
  assert.equal(untangle("2lo0c0ke7d away.", "2007"), "locked away.");
  assert.equal(untangle("\u201cThe first step towards gwrewatwSE.pRuVgICdEuins\u2026dWeeilslainfganreisss.\u201dcom", "www.pugdundeesafaris.com"), "\u201cThe first step towards greatSERVICEis\u2026Willingness\u201d");
  assert.equal(untangle("Opened in 2007 by the owner", "2007"), null);
  assert.equal(untangle("Visit www.pugdundeesafaris.com today", "www.pugdundeesafaris.com"), null);
  assert.equal(untangle("2 cups, 0.5 l of water, 0 sugar for 7 days", "2007"), null, "spread over words: real text");
  assert.ok(isFooter(" www.pugdundeesafaris.com/ ") && isFooter("2024") && !isFooter("2025 budget"));
});

test("clean-up: text boxes are read once (not their fallback copy); slide numbers in boxes are dropped", async () => {
  const { sections } = await importSmall();
  const c1 = sections.find((s) => s.code === "C-1")!;
  const t = all(c1.body);
  for (const x of ["S.NO", "Item", "Radiator"]) assert.ok(t.includes(x), x);
  assert.ok(!/FALLBACK/.test(sections.map((s) => all(s.body)).join(" ")));
  assert.ok(!t.split("\n").includes("01"));
});

test("clean-up: pictures: the page background and tiny icons are left out, a real picture is kept", async () => {
  const { cleaned, sections } = await importSmall();
  assert.equal(cleaned.stats.imagesKept, 1);
  assert.equal(cleaned.stats.imagesDropped, 6); // 5 backgrounds + 1 icon
  const imgs = sections.flatMap((s) => find(s.body, "image"));
  assert.deepEqual(imgs.map((i) => i.attrs?.src), ["/sop/media/images/media_image9_png.png"]);
});

// ---------------------------------------------------------------- sections

test("sections: start at each section code (in any form) and at Training; the rest is the introduction", async () => {
  const { sections } = await importSmall();
  assert.deepEqual(
    sections.map((s) => s.title),
    ["Introduction", "A-1 GUEST CHECK-IN AT LODGE AND PRIOR", "Training", "A-2 During the Stay of Guest", "B-1 Accounts Procedure at the Lodge", "B-5 Kitchen upkeep (TRAINING)", "C-1 Gypsy Maintenance", "A-17 Festivals with Guests"]
  );
  const intro = all(sections[0].body);
  assert.match(intro, /Standard Operating Procedure/);
  assert.match(intro, /most important visitor/);
});

test("sections: a sub-code (B \u2013 5 (a), (b)) and Procedure stay headings inside; a part title opens the next section", async () => {
  const { sections } = await importSmall();
  const heads = (code: string) => find(sections.find((s) => s.code === code)!.body, "heading").map((h) => docText({ type: "doc", content: [h] }));
  assert.deepEqual(heads("B-5"), ["B \u2013 5 (a) Personal Hygiene", "B \u2013 5 (b) Preparation for Kitchen Service:"]);
  assert.deepEqual(heads("B-1"), ["SOP \u2013 Lodge Operations"], "the part title is at the top of B-1, not the end of A-2");
  assert.deepEqual(heads("C-1"), ["SOP \u2013 Maintenance & more"]);
  assert.deepEqual(heads("A-17"), ["Diwali"]);
  assert.ok(find(sections.find((s) => s.title === "Training")!.body, "heading").some((h) => docText({ type: "doc", content: [h] }) === "Procedure:"));
});

test("sections: the rules for a section code", () => {
  const p = (text: string, style = "") => ({ kind: "p" as const, style, runs: [{ text }], text });
  assert.equal(sectionStart(p("A \u2013 11 House Keeping \u2013Common guidelines:"))?.title, "A-11 House Keeping \u2013Common guidelines");
  assert.equal(sectionStart(p("D\u2013 8. Emergency & Safety (TRAINING & REGULAR DISCUSSION):"))?.code, "D-8");
  assert.equal(sectionStart(p("B \u2013 5 (b) Preparation for Kitchen Service:")), null);
  assert.equal(sectionStart(p("B \u2013 8 Lodge Organization, Communication, and Meetings: Procedure:"))?.sub, "Procedure:");
  assert.equal(sectionStart(p("1.2Emergency Evacuation", "Heading2")), null);
  assert.equal(sectionStart(p("Call the A-1 team for help with the luggage of the guests")), null, "a code inside a sentence");
  assert.equal(sectionStart(p("Training", "Heading2")), null, "only the 'Training:' title, not a 'Training' sub-heading");
  assert.equal(sectionStart({ ...p("A-3 in a box"), textbox: true }), null);
});

test("sections: the owner can move a break in the preview", async () => {
  const { cleaned } = await importSmall();
  const cands = candidates(cleaned.blocks);
  const training = cands.find((c) => c.text === "Training:")!;
  const diwali = cands.find((c) => c.text === "Diwali")!;
  assert.equal(training.split, true);
  assert.equal(diwali.split, false);
  const changed = buildSections(cleaned, { [training.index]: false, [diwali.index]: true });
  assert.ok(!changed.some((s) => s.title === "Training"), "Training stays inside A-1");
  assert.ok(changed.some((s) => s.title === "Diwali"));
});

// ---------------------------------------------------------------- content

test("content: numbered and bullet lists (nested by level), '\u00b7' lines as bullets, bold and links, a table", async () => {
  const { sections } = await importSmall();
  const a1 = sections.find((s) => s.code === "A-1")!.body;
  assert.equal(a1.content[0].type, "orderedList");
  const nested = a1.content[0].content![0].content!;
  assert.equal(nested[1].type, "bulletList", "the level-1 item is a list inside the first item");
  assert.equal(a1.content[1].type, "bulletList");
  assert.deepEqual(a1.content[1].content!.map((li) => docText({ type: "doc", content: li.content! })), ["About our lodge", "Meal timings"]);
  assert.equal(sections.find((s) => s.title === "Training")!.body.content.find((n) => n.type === "bulletList")?.type, "bulletList", "numId 2 is a bullet list");

  const a2 = sections.find((s) => s.code === "A-2")!.body;
  const para = a2.content.find((n) => n.type === "paragraph" && /reservations/.test(docText({ type: "doc", content: [n] })))!;
  assert.deepEqual(para.content, [
    { type: "text", text: "Call reservations ", marks: [{ type: "bold" }] },
    { type: "text", text: "by email", marks: [{ type: "link", attrs: { href: "mailto:reservation@pugdundeesafaris.com" } }] },
    { type: "text", text: " today." },
  ]);

  const table = find(sections.find((s) => s.code === "C-1")!.body, "table")[0];
  assert.equal(table.content!.length, 3, "the empty row is dropped");
  assert.equal(table.content![2].content![0].attrs?.colspan, 2);
  assert.equal(docText({ type: "doc", content: [table] }), "Item | Schedule\nRadiator | Every 10 trips\nCheck daily");
});

test("content: every imported section passes the server's clean-up unchanged", async () => {
  const { sections } = await importSmall();
  for (const s of sections) assert.deepEqual(sanitizeDoc(s.body), s.body, s.title);
});

// ---------------------------------------------------------------- the owner's real file

const REAL = join(__dirname, "..", "..", "rate-docs", "2024_SOP__pptx_1.docx");
test("the owner's real SOP file (rate-docs/, not committed): 62 sections A-1 ... F-7, no footers left", { skip: !existsSync(REAL) && "rate-docs/2024_SOP__pptx_1.docx is not here" }, async () => {
  const parts = await readDocx(new Uint8Array(readFileSync(REAL)), inflate);
  const cleaned = cleanBlocks(parseDocument(parts.document, parts.rels, parts.numbering));
  const sections = buildSections(cleaned);
  assert.equal(sections.length, 62);
  assert.equal(sections[0].title, "Introduction");
  assert.equal(sections[1].title, "A-1 GUEST CHECK-IN AT LODGE AND PRIOR");
  assert.equal(sections[2].title, "Training");
  assert.equal(sections[3].title, "A-2 During the Stay of Guest");
  assert.equal(sections[sections.length - 1].title, "F-7 Naturalist\u2019s behavior in the National Park");
  const codes = sections.map((s) => s.code).filter(Boolean);
  for (const c of ["A-1", "A-17", "B-1", "B-14", "C-1", "C-4", "D-1", "D-10", "E-1", "E-6", "F-1", "F-7"]) assert.ok(codes.includes(c), c);
  const lines = sections.flatMap((s) => docText(s.body).split("\n"));
  for (const f of ["2007", "2024", "2026", "www.pugdundeesafaris.com"]) assert.ok(!lines.some((l) => l.trim() === f), f);
  assert.equal(cleaned.stats.footers, 238);
  assert.ok(cleaned.stats.garbled >= 20, "lines with the footer mixed in are flagged for checking");
  assert.ok(sections.reduce((n, s) => n + s.counts.tables, 0) >= 3);
  assert.equal(cleaned.stats.imagesKept, 0, "the file's pictures are the slide background and bullet icons");
  for (const s of sections) assert.deepEqual(sanitizeDoc(s.body), s.body, s.title);
});

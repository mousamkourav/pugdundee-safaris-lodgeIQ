// Run with:  npx tsx --test lib/sop/pdf.test.ts
//
// "Download PDF": the file builds; cover with title, version and date; contents with each
// section's page (and a link to it); every section from a new page; "Page X of Y" on every page
// after the cover; lists, tables and pictures; characters the PDF fonts lack are spelt out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSopPdf, pdfText } from "./pdf";
import { imageSize } from "./image-size";
import type { Doc, PMNode } from "./types";

const para = (t: string): PMNode => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const long = (n: number): Doc => ({ type: "doc", content: Array.from({ length: n }, (_, i) => para(`Line ${i + 1}: guests are welcomed at the lodge with a cold towel and a drink.`)) });

// a 2 x 2 red PNG
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64"));

const sections = [
  { title: "Introduction", body: { type: "doc", content: [para("A customer is the most important visitor on our premises.")] } as Doc },
  {
    title: "A-1 GUEST CHECK-IN AT LODGE AND PRIOR",
    body: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Procedure:" }] },
        { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [para("Call the guest a day prior."), { type: "bulletList", content: [{ type: "listItem", content: [para("Ask about children.")] }] }] }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1 }, content: [para("Item")] }, { type: "tableHeader", attrs: { colspan: 1 }, content: [para("Schedule")] }] }, { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1 }, content: [para("Radiator")] }, { type: "tableCell", attrs: { colspan: 1 }, content: [para("Every 10 trips")] }] }] },
        { type: "image", attrs: { src: "/sop/media/images/red.png", alt: "" } },
        para("Rates in \u20b9 \u2013 \u201cquoted\u201d \u2022 clearly \u0938\u094d\u0935\u093e\u0917\u0924"),
      ],
    } as Doc,
  },
  { title: "B-10 Garbage handling (TRAINING)", body: long(80) },
];

function build() {
  const pdf = buildSopPdf({ title: "Standard Operating Procedures", version: 3, published: "3 Nov 2026", sections, images: new Map([["/sop/media/images/red.png", { data: PNG, format: "PNG", width: 2, height: 2 }]]), compress: false });
  return { pdf, raw: pdf.output() };
}

test("PDF: builds; cover, contents, each section from a new page, page numbers", () => {
  const { pdf, raw } = build();
  const pages = pdf.getNumberOfPages();
  // cover + contents + Introduction + A-1 + B-10 (80 lines: more than one page)
  assert.ok(pages >= 6, `pages: ${pages}`);
  for (const t of ["(PUGDUNDEE SAFARIS)", "(Standard Operating Procedures)", "(Version 3)", "(Published 3 Nov 2026)", "(Contents)"]) assert.ok(raw.includes(t), t);
  assert.ok(raw.includes(`(Page 2 of ${pages})`) && raw.includes(`(Page ${pages} of ${pages})`));
  assert.ok(!raw.includes("(Page 1 of"), "no page number on the cover");
  assert.ok(raw.includes("(Pugdundee Safaris SOP - version 3)"));
  // the contents: each title with its page (Introduction on 3, A-1 on 4, B-10 on 5) and a link
  for (const [t, p] of [["Introduction", 3], ["A-1 GUEST CHECK-IN AT LODGE AND PRIOR", 4], ["B-10 Garbage handling \\(TRAINING\\)", 5]] as const) {
    assert.ok(raw.includes(`(${t})`), t);
    assert.ok(raw.includes(`(${p}) Tj`), `page ${p}`);
  }
  assert.equal((raw.match(/\/Subtype \/Link/g) ?? []).length, 3, "one link per contents line");
  assert.equal((pdf.getPageInfo(4).pageContext as { mediaBox?: unknown }) != null, true);
  assert.ok(raw.includes("(Radiator)") && raw.includes("(Every 10 trips)"), "table cells");
  assert.ok(raw.includes("/Subtype /Image"), "the picture is in");
  assert.ok(raw.includes("(Line 80: guests"), "a long section runs onto the next page");
});

test("PDF text: characters the PDF fonts lack are spelt out or left out", () => {
  assert.equal(pdfText("Rates in \u20b9 2,000"), "Rates in Rs. 2,000");
  assert.equal(pdfText("\u201cquoted\u201d \u2013 \u2022 caf\u00e9"), "\u201cquoted\u201d \u2013 \u2022 caf\u00e9", "Windows characters stay");
  assert.equal(pdfText("\u0938\u094d\u0935\u093e\u0917\u0924 ok"), " ok", "Hindi is left out (the PDF's fonts cannot show it)");
  assert.equal(pdfText("tab\there"), "tab here");
});

test("picture sizes from PNG and JPEG headers", () => {
  assert.deepEqual(imageSize(PNG), { format: "PNG", width: 2, height: 2 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 30, 0, 40, 3, 0, 0]);
  assert.deepEqual(imageSize(jpeg), { format: "JPEG", width: 40, height: 30 });
  assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
});

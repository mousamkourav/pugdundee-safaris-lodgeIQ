// Run with:  npx tsx --test lib/sop/versions.test.ts
//
// SOP versions and content: what changed between versions (sections added / removed / edited /
// renamed / moved), restoring an old version as the draft, the server's clean-up of what the
// editor sends, the HTML kept with each section, and search with highlighted words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSections, diffIsEmpty, toDraftRows, sanitizeDoc, docHtml, docText, searchSections, highlightParts, queryWords } from "./content";
import type { Doc } from "./types";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const doc = (...lines: string[]): Doc => ({ type: "doc", content: lines.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })) });
const sec = (n: number, title: string, text: string) => ({ id: ID(n), title, text });

// ---------------------------------------------------------------- what changed

test("what changed: added, removed, edited, renamed, moved; followed by the section's id", () => {
  const v1 = [sec(1, "A-1 Check-in", "Call the guest."), sec(2, "A-2 Stay", "Recheck comfort."), sec(3, "A-3 Departure", "Bill ready."), sec(4, "A-4 Requests", "Assess.")];
  const v2 = [sec(1, "A-1 Check-in", "Call the guest a day prior."), sec(3, "A-3 Check out", "Bill ready."), sec(4, "A-4 Requests", "Assess."), sec(2, "A-2 Stay", "Recheck comfort."), sec(5, "A-5 Complaints", "Listen.")];
  const d = diffSections(v1, v2);
  assert.deepEqual(d.added, ["A-5 Complaints"]);
  assert.deepEqual(d.removed, []);
  assert.deepEqual(d.edited, ["A-1 Check-in"]);
  assert.deepEqual(d.renamed, [{ from: "A-3 Departure", to: "A-3 Check out" }]);
  assert.deepEqual(d.moved, ["A-2 Stay"], "only the section that was moved, not its neighbours");
  const gone = diffSections(v1, v1.slice(1));
  assert.deepEqual([gone.removed, gone.moved], [["A-1 Check-in"], []]);
  assert.equal(diffIsEmpty(diffSections(v1, v1)), true);
  assert.deepEqual(diffSections([], v1).added.length, 4, "the first version: every section is new");
});

// ---------------------------------------------------------------- restore

test("restore an old version as the draft: same sections, same ids, same order, text and HTML rebuilt", () => {
  const old = [
    { id: ID(1), title: "A-1 Check-in", body: doc("Call the guest.") },
    { id: ID(2), title: "  A-2   Stay ", body: doc("Recheck comfort.") },
  ];
  const rows = toDraftRows(old);
  assert.deepEqual(rows.map((r) => [r.id, r.title, r.body_text, r.body_html]), [
    [ID(1), "A-1 Check-in", "Call the guest.", "<p>Call the guest.</p>"],
    [ID(2), "A-2 Stay", "Recheck comfort.", "<p>Recheck comfort.</p>"],
  ]);
  // published again unchanged: "what changed" says nothing
  assert.equal(diffIsEmpty(diffSections(old.map((s, i) => ({ id: s.id, title: rows[i].title, text: rows[i].body_text })), rows.map((r) => ({ id: r.id!, title: r.title, text: r.body_text })))), true);
  // an import (no ids) or a repeated id: new sections
  assert.equal(toDraftRows([{ title: "X", body: doc("x") }])[0].id, undefined);
  assert.equal(toDraftRows([{ id: ID(1), title: "X", body: doc() }, { id: ID(1), title: "Y", body: doc() }])[1].id, undefined);
  assert.equal(toDraftRows([{ id: "not-an-id", title: "X", body: doc() }])[0].id, undefined);
  assert.throws(() => toDraftRows([]), /No sections/);
  assert.equal(toDraftRows([{ title: "", body: doc() }])[0].title, "Section 1");
});

// ---------------------------------------------------------------- the server's clean-up

test("clean-up of what the editor sends: only known content, safe links, our own pictures", () => {
  const dirty = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "ok", marks: [{ type: "bold" }, { type: "bold" }, { type: "evil" }, { type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
      { type: "paragraph", content: [{ type: "text", text: "mail", marks: [{ type: "link", attrs: { href: "mailto:sales@pugdundeesafaris.com" } }] }] },
      { type: "script", content: [{ type: "text", text: "alert(1)" }] },
      { type: "heading", attrs: { level: 1, onclick: "x" }, content: [{ type: "text", text: "Title" }] },
      { type: "image", attrs: { src: "https://evil.example/x.png" } },
      { type: "image", attrs: { src: "/sop/media/images/ab-12.png", alt: "Pool", onerror: "x" } },
      { type: "image", attrs: { src: "/sop/media/images/../../secret.png" } },
      { type: "bulletList", content: [{ type: "paragraph" }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 999 } }] }] },
      { type: "codeBlock", content: [{ type: "text", text: "x" }] },
    ],
  };
  const clean = sanitizeDoc(dirty);
  assert.deepEqual(clean.content, [
    { type: "paragraph", content: [{ type: "text", text: "ok", marks: [{ type: "bold" }] }] },
    { type: "paragraph", content: [{ type: "text", text: "mail", marks: [{ type: "link", attrs: { href: "mailto:sales@pugdundeesafaris.com" } }] }] },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Title" }] },
    { type: "image", attrs: { src: "/sop/media/images/ab-12.png", alt: "Pool" } },
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph" }] }] }] },
  ]);
  assert.deepEqual(sanitizeDoc(null), { type: "doc", content: [{ type: "paragraph" }] });
  assert.deepEqual(sanitizeDoc({ type: "doc", content: "x" }), { type: "doc", content: [{ type: "paragraph" }] });
  const huge = { type: "doc", content: Array.from({ length: 70_000 }, () => ({ type: "paragraph" })) };
  assert.throws(() => sanitizeDoc(huge), /too long/);
});

test("HTML kept with each section: everything escaped", () => {
  const d: Doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "<script>alert('x')</script> & more", marks: [{ type: "bold" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "link", marks: [{ type: "link", attrs: { href: 'https://a.b/"x' } }] }] },
      { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] },
    ],
  };
  assert.equal(
    docHtml(d),
    '<p><strong>&lt;script&gt;alert(\'x\')&lt;/script&gt; &amp; more</strong></p><p><a href="https://a.b/&quot;x" rel="noopener noreferrer">link</a></p><ol><li><p>one</p></li></ol>'
  );
  assert.equal(docText(d), "<script>alert('x')</script> & more\nlink\none");
});

// ---------------------------------------------------------------- search

test("search across sections: every word must be there; counted; snippets; highlighted, any case", () => {
  const sections = [
    sec(1, "A-9 Housekeeping", "Turn down service during dinner time.\nTurn down the bed and place the Turndown card."),
    sec(2, "B-6 Pool upkeep", "Check the pool water daily.\nClean the pool deck."),
    sec(3, "A-14 Guest meals", "Dinner is served at 8 pm."),
  ];
  assert.deepEqual(queryWords("  Turn-down, a  "), ["turn", "down"]);
  const hits = searchSections(sections, "dinner");
  assert.deepEqual(hits.map((h) => h.title), ["A-9 Housekeeping", "A-14 Guest meals"]);
  assert.deepEqual(searchSections(sections, "pool water").map((h) => [h.title, h.count]), [["B-6 Pool upkeep", 4]]);
  assert.deepEqual(searchSections(sections, "pool dinner"), [], "every word must be in the section");
  assert.deepEqual(searchSections(sections, "upkeep").map((h) => h.title), ["B-6 Pool upkeep"], "titles are searched too");
  assert.deepEqual(searchSections(sections, "x"), [], "one letter is not searched");
  assert.deepEqual(highlightParts("Turn DOWN the bed", ["down"]), [
    { text: "Turn ", hit: false },
    { text: "DOWN", hit: true },
    { text: " the bed", hit: false },
  ]);
  assert.deepEqual(highlightParts("a (b) c", ["(b)"]), [{ text: "a ", hit: false }, { text: "(b)", hit: true }, { text: " c", hit: false }], "special characters are safe");
});

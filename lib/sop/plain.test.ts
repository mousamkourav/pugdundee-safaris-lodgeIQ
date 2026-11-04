// Run with:  npx tsx --test lib/sop/plain.test.ts
//
// Live site, 4 Nov 2026: Save in the SOP editor said "Cannot access start on the server. You
// cannot dot into a temporary client reference ...". Cause: editor.getJSON() hands over
// ProseMirror's own attrs objects (no prototype); a server action receives those as opaque
// temporary references, and the server's clean-up reads attrs.start / attrs.level. The editor
// now sends plain JSON (toPlainJson).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toPlainJson, isPlainData, isTemporaryReferenceError, NOT_PLAIN } from "./plain";

const ROOT = join(__dirname, "..", "..");

test("the editor's section through a real server action round trip: fails as on the live site raw, works as plain JSON", () => {
  // React's server side needs the "react-server" condition: its own Node process
  const r = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", join(__dirname, "testing", "action-roundtrip.ts")], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  const line = r.stdout.trim().split("\n").pop() ?? "";
  assert.ok(line.startsWith("{"), `helper output: ${r.stdout}\n${r.stderr}`);
  const out = JSON.parse(line);
  assert.equal(out.editorJsonIsPlain, false, "editor.getJSON() is not plain data (ProseMirror attrs have no prototype)");
  assert.equal(out.raw.ok, false);
  assert.match(out.raw.error, /You cannot dot into a temporary client reference/, "the live error, reproduced");
  assert.equal(out.plainIsPlain, true);
  assert.deepEqual(out.plain, { ok: true, firstListStart: 1, nodes: 4 }, "plain JSON: saved, the numbered list keeps its start");
});

test("the editor sends plain JSON to the server; the server never shows React's message", () => {
  const editor = readFileSync(join(ROOT, "app", "(dashboard)", "sop", "_ui", "edit-mode.tsx"), "utf8");
  assert.match(editor, /saveSection\(\{ id: current\.id, title, body: toPlainJson\(editor\.getJSON\(\)\), ask \}\)/);
  // nowhere in the app is editor.getJSON() passed on raw
  const raw = editor.match(/getJSON\(\)/g)?.length ?? 0;
  const wrapped = editor.match(/toPlainJson\(editor\.getJSON\(\)\)/g)?.length ?? 0;
  assert.equal(raw, wrapped, "every getJSON() is wrapped in toPlainJson");
  const actions = readFileSync(join(ROOT, "app", "(dashboard)", "sop", "admin-actions.ts"), "utf8");
  assert.match(actions, /if \(isTemporaryReferenceError\(e\)\) return \{ error: NOT_PLAIN \};/);
  assert.equal(isTemporaryReferenceError(new Error("Cannot access start on the server. You cannot dot into a temporary client reference from a server component.")), true);
  assert.match(NOT_PLAIN, /reload the page/);
});

test("plain data: what a server action can read", () => {
  const noProto = Object.assign(Object.create(null), { start: 1 });
  assert.equal(isPlainData({ type: "orderedList", attrs: noProto }), false);
  assert.equal(isPlainData(toPlainJson({ type: "orderedList", attrs: noProto })), true);
  assert.deepEqual(toPlainJson({ attrs: noProto }), { attrs: { start: 1 } });
  assert.equal(isPlainData({ a: [1, "x", null, true, { b: 2 }] }), true);
  assert.equal(isPlainData({ d: new Date() }), false);
  assert.equal(isPlainData({ f: () => 1 }), false);
});

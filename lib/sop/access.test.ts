// Run with:  npx tsx --test lib/sop/access.test.ts
//
// SOP permissions and "I have read": who sees the tab and the pages (super admin; by person; by
// role), that nothing changes for anyone without access, that only the super admin edits and
// publishes, that every SOP page / action / route checks the caller on the server, and that the
// database rules (supabase/sop_module.sql) say the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { canViewSop, isSopEditor, readStatus, showReadBanner, audience, readReport, NO_SOP, type AccessRow, type Person } from "./access";
import { modulesFor, moduleForPath, MODULES, NAV } from "@/components/nav";
import type { Role } from "@/lib/auth";

const ALICE = "11111111-1111-1111-1111-111111111111"; // lodge manager, access by person
const BOB = "22222222-2222-2222-2222-222222222222"; // sales member, access by role
const CARA = "33333333-3333-3333-3333-333333333333"; // lodge accounts, no access
const rows: AccessRow[] = [
  { user_id: ALICE, role: null },
  { user_id: null, role: "sales_member" },
];

// ---------------------------------------------------------------- who may read

test("access: the super admin always; others by person or by role (either is enough); nobody else", () => {
  assert.equal(canViewSop("x", "super_admin", []), true);
  assert.equal(canViewSop(ALICE, "lodge_manager", rows), true, "by person");
  assert.equal(canViewSop(BOB, "sales_member", rows), true, "by role");
  assert.equal(canViewSop(CARA, "lodge_accounts", rows), false);
  assert.equal(canViewSop(CARA, "lodge_accounts", []), false);
  assert.equal(canViewSop(null, "sales_member", rows), false, "not signed in");
  assert.equal(canViewSop(CARA, "senior_manager", rows), false, "senior managers need access like everyone else");
  // access removed: gone at once
  assert.equal(canViewSop(ALICE, "lodge_manager", rows.slice(1)), false);
  assert.equal(canViewSop(BOB, "sales_member", rows.slice(0, 1)), false);
});

test("access: only the super admin edits, imports and publishes", () => {
  assert.equal(isSopEditor("super_admin"), true);
  for (const r of ["senior_manager", "sales_admin", "delhi_accounts", "lodge_manager", "sales_member", "task_creator", "", null, "SUPER_ADMIN"]) assert.equal(isSopEditor(r), false, String(r));
});

test("status from the database: read defensively; an error or odd answer = no access", () => {
  assert.deepEqual(readStatus(null), NO_SOP);
  assert.deepEqual(readStatus("yes"), NO_SOP);
  assert.deepEqual(readStatus({ can_view: "true" }).canView, false);
  const s = readStatus({ can_view: true, is_editor: false, document_id: "d", version: 3, version_id: "v3", read: false });
  assert.deepEqual(s, { canView: true, isEditor: false, documentId: "d", version: 3, versionId: "v3", read: false });
});

// ---------------------------------------------------------------- the tab

test("the SOP tab: shown with access only; without it every role's tabs are exactly as before", () => {
  const keys = (r: Role, a: boolean) => modulesFor(r, a).map((m) => m.key);
  // without access: as today (super roles switch between the two modules; others have no switcher)
  assert.deepEqual(keys("super_admin", false), ["reporting", "sales"]);
  assert.deepEqual(keys("senior_manager", false), ["reporting", "sales"]);
  for (const r of ["delhi_accounts", "lodge_manager", "operations_manager", "lodge_accounts", "sales_member", "sales_admin", "task_creator"] as Role[]) assert.deepEqual(keys(r, false), [], r);
  // with access: a third tab
  assert.deepEqual(keys("super_admin", true), ["reporting", "sales", "sop"]);
  assert.deepEqual(modulesFor("lodge_manager", true).map((m) => m.label), ["Lodge Reporting", "SOP"]);
  assert.deepEqual(modulesFor("sales_member", true).map((m) => m.label), ["Sales & Itinerary", "SOP"]);
  assert.deepEqual(modulesFor("task_creator", true).map((m) => [m.label, m.href]), [["Trip reports", "/trip-reports"], ["SOP", "/sop"]]);
  assert.deepEqual(MODULES.map((m) => m.label), ["Lodge Reporting", "Sales & Itinerary", "SOP"], "SOP is the third tab");
});

test("the SOP pages are their own module; Sales and Lodge pages are unchanged", () => {
  assert.equal(moduleForPath("/sop", "lodge_manager"), "sop");
  assert.equal(moduleForPath("/sop/edit", "super_admin"), "sop");
  assert.equal(moduleForPath("/sop", "sales_member"), "sop");
  assert.equal(moduleForPath("/sales/new", "super_admin"), "sales");
  assert.equal(moduleForPath("/dashboard", "sales_member"), "sales");
  assert.equal(moduleForPath("/sopx", "lodge_manager"), "reporting");
  assert.equal(moduleForPath("/dashboard", "lodge_manager"), "reporting");
  const admin = NAV.filter((g) => g.module === "sop").flatMap((g) => g.items).filter((i) => i.href !== "/sop");
  assert.ok(admin.length >= 6);
  for (const i of admin) assert.deepEqual(i.roles, ["super_admin"], i.href);
});

// ---------------------------------------------------------------- "I have read"

test("banner 'New SOP version - please read': staff with access, until they have read it; never the super admin", () => {
  const s = { canView: true, isEditor: false, documentId: "d", version: 2, versionId: "v2", read: false };
  assert.equal(showReadBanner(s), true);
  assert.equal(showReadBanner({ ...s, read: true }), false, "read: gone");
  assert.equal(showReadBanner({ ...s, version: 3, versionId: "v3", read: false }), true, "a new version: asked again");
  assert.equal(showReadBanner({ ...s, version: null, versionId: null }), false, "nothing published");
  assert.equal(showReadBanner({ ...s, canView: false }), false, "no access");
  assert.equal(showReadBanner({ ...s, isEditor: true }), false, "the super admin publishes it");
});

test("who has read: everyone with access (by person or role), active, not the super admin; not read first; role and lodge", () => {
  const people: Person[] = [
    { id: ALICE, full_name: "Alice", role: "lodge_manager", status: "active" },
    { id: BOB, full_name: "Bob", role: "sales_member", status: "active" },
    { id: "44444444-4444-4444-4444-444444444444", full_name: "Dev", role: "sales_member", status: "active" },
    { id: "55555555-5555-5555-5555-555555555555", full_name: "Old", role: "sales_member", status: "disabled" },
    { id: CARA, full_name: "Cara", role: "lodge_accounts", status: "active" },
    { id: "66666666-6666-6666-6666-666666666666", full_name: "Owner", role: "super_admin", status: "active" },
  ];
  assert.deepEqual(audience(people, rows).map((p) => p.full_name), ["Alice", "Bob", "Dev"]);
  const report = readReport(people, rows, [{ user_id: BOB, read_at: "2026-11-03T10:00:00Z" }], (id) => (id === ALICE ? ["Kings Lodge", "Tree House Hideaway"] : []), (r) => r.replace("_", " "));
  assert.deepEqual(
    report.map((r) => [r.name, r.role, r.lodges, r.readAt]),
    [
      ["Alice", "lodge manager", "Kings Lodge, Tree House Hideaway", null],
      ["Dev", "sales member", "", null],
      ["Bob", "sales member", "", "2026-11-03T10:00:00Z"],
    ]
  );
});

// ---------------------------------------------------------------- every page, action and route checks on the server

const ROOT = join(__dirname, "..", "..");
const SOP_DIR = join(ROOT, "app", "(dashboard)", "sop");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const rel = (f: string) => f.slice(SOP_DIR.length + 1).replace(/\\/g, "/");

test("every SOP page checks access on the server: reading = requireSopViewer, admin pages = requireSopEditor", () => {
  const pages = files(SOP_DIR).filter((f) => /[\\/]page\.tsx$/.test(f));
  assert.ok(pages.length >= 8, `found ${pages.length}`);
  for (const f of pages) {
    const src = readFileSync(f, "utf8");
    const r = rel(f);
    if (r === "page.tsx") assert.match(src, /await requireSopViewer\(\)/, r);
    else assert.match(src, /await requireSopEditor\(\)/, `${r}: an admin page`);
  }
});

test("every SOP server action and route checks the caller first; admin ones need the super admin", () => {
  const all = files(SOP_DIR);
  const actions = all.filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")));
  const routes = all.filter((f) => /[\\/]route\.ts$/.test(f));
  assert.deepEqual(actions.map(rel).sort(), ["actions.ts", "admin-actions.ts"]);
  assert.ok(routes.length >= 4);
  for (const f of actions) {
    const src = readFileSync(f, "utf8");
    const editorOnly = rel(f) === "admin-actions.ts";
    for (const m of src.matchAll(/export async function (\w+)/g)) {
      const body = src.slice(m.index!);
      const end = body.indexOf("\nexport ", 10);
      const own = end > 0 ? body.slice(0, end) : body;
      // the first thing awaited is the check
      if (editorOnly) assert.equal(/await (\w+)\(/.exec(own)?.[1], "guard", `${rel(f)}: ${m[1]}() must start with guard()`);
      else assert.match(own, /getCurrentUser\(\)[\s\S]*sopActor\(\)/, `${rel(f)}: ${m[1]}()`);
    }
    if (editorOnly) assert.match(src, /async function guard\(\) \{\s*const cu = await getCurrentUser\(\);[\s\S]*?return sopEditor\(\);/);
  }
  for (const f of routes) {
    const src = readFileSync(f, "utf8");
    const r = rel(f);
    assert.match(src, /await getCurrentUser\(\)/, r);
    if (r.startsWith("reads/")) assert.match(src, /await sopEditor\(\)/, `${r}: super admin only`);
    else assert.match(src, /await sopActor\(\)/, r);
  }
});

test("the server checks: sopEditor needs the super admin as well as access", () => {
  const src = readFileSync(join(__dirname, "server.ts"), "utf8");
  assert.match(src, /export async function sopEditor[\s\S]*?isSopEditor\(a\.role\) \|\| !a\.status\.isEditor/);
  assert.match(src, /export async function requireSopEditor[\s\S]*?isSopEditor\(profile\?\.role\) \|\| !status\.isEditor/);
  assert.match(src, /if \(error\) return NO_SOP;/, "the SQL not run yet = no access, the tab stays hidden");
});

// ---------------------------------------------------------------- the database says the same

test("SQL: one idempotent block, RLS on every SOP table, every change checked for the super admin", () => {
  const sql = readFileSync(join(ROOT, "supabase", "sop_module.sql"), "utf8");
  assert.match(sql, /^-- =+\n-- SOP module/, "comment block on top");
  assert.equal((sql.match(/^do \$sop\$/gm) ?? []).length, 1, "one DO block");
  assert.match(sql, /\$sop\$;\s*\n[\s\S]*\nselect 'tables'/, "a check select after it");
  const tables = [...sql.matchAll(/create table if not exists public\.(sop_\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables, ["sop_documents", "sop_sections", "sop_versions", "sop_version_sections", "sop_access", "sop_reads", "sop_audit"]);
  for (const t of tables) assert.match(sql, new RegExp(`alter table public\\.${t}\\s+enable row level security`), t);
  assert.ok(!/create table (?!if not exists)/.test(sql), "idempotent tables");
  assert.ok(!/create policy (?!sop_)/.test(sql));
  for (const m of sql.matchAll(/create policy (\w+)/g)) assert.match(sql, new RegExp(`drop policy if exists ${m[1]} `), `${m[1]}: idempotent`);
  // changing functions refuse anyone but the super admin
  for (const fn of ["sop_replace_draft", "sop_publish", "sop_set_order", "sop_grant", "sop_revoke"]) {
    const body = sql.slice(sql.indexOf(`function public.${fn}(`));
    assert.match(body.slice(0, 400), /if not public\.sop_is_editor\(\) then raise exception/, fn);
  }
  assert.match(sql, /sop_is_editor\(\)[\s\S]*?p\.role = 'super_admin' and p\.status = 'active'/);
  // the draft is the super admin's; staff read published versions only, when given access
  assert.match(sql, /policy sop_sections_editor on public\.sop_sections for all using \(public\.sop_is_editor\(\)\)/);
  assert.match(sql, /policy sop_versions_read on public\.sop_versions for select using \(public\.sop_can_view\(document_id\)\)/);
  assert.match(sql, /a\.user_id = p\.id or a\.role = p\.role/, "by person or by role");
  // "I have read": only yourself, only a version you may read
  assert.match(sql, /policy sop_reads_insert[\s\S]*?user_id = auth\.uid\(\) and exists \(select 1 from public\.sop_versions v where v\.id = version_id and public\.sop_can_view/);
  // nobody writes versions, access or the audit directly (only through the functions)
  for (const t of ["sop_versions", "sop_version_sections", "sop_access", "sop_audit"]) assert.ok(!new RegExp(`on public\\.${t} for (insert|update|delete|all)`).test(sql), t);
  assert.match(sql, /insert into storage\.buckets[\s\S]*'sop-media', 'sop-media', false/, "a private bucket");
});

// Owner, 4 Nov 2026: the Word file (122 MB) is not stored; staff download the PDF.
test("the original Word file is never uploaded; its download shows only when one is stored", () => {
  const importer = readFileSync(join(SOP_DIR, "import", "importer.tsx"), "utf8");
  const actions = readFileSync(join(SOP_DIR, "admin-actions.ts"), "utf8");
  assert.ok(!/original\//.test(actions) && !/original_path/.test(actions), "no upload link or record for the Word file");
  assert.ok(!/uploadToSignedUrl\([^)]*parsed\.file/.test(importer), "the browser does not upload the Word file");
  assert.ok(!/not kept/i.test(importer), "no 'original was not kept' warning");
  const page = readFileSync(join(SOP_DIR, "page.tsx"), "utf8");
  assert.match(page, /\{hasOriginal && \(\s*<a href="\/sop\/original"/, "the link only when a file is stored");
  assert.match(page, /<a href="\/sop\/pdf"/);
});

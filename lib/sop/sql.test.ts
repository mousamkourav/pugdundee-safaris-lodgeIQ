// Run with:  npx tsx --test lib/sop/sql.test.ts
//
// The SOP database rules, for real: supabase/sop_module.sql runs (twice) in an in-memory
// Postgres (PGlite), with stand-ins for what Supabase provides (auth.uid(), profiles, the
// storage buckets table, the anon / authenticated roles and their default grants). Each check
// runs as a signed-in user under row level security, like the app does.
//
// - an imported SOP never published becomes version 1 the first time anyone with access opens it
//   (once);
// - a save goes live at once as a new version; "Ask staff to read" gives the banner, a save
//   without it does not;
// - staff cannot edit, publish, import, restore, reorder, ask to read or change access;
// - what Access & reading shows (access list, everyone's reads, audit) is for the super admin only.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(join(__dirname, "..", "..", "supabase", "sop_module.sql"), "utf8");
const U = {
  owner: "00000000-0000-0000-0000-000000000001", // super admin
  alice: "00000000-0000-0000-0000-000000000002", // lodge manager, access by person
  bob: "00000000-0000-0000-0000-000000000003", // sales member, access by role
  cara: "00000000-0000-0000-0000-000000000004", // lodge accounts, no access
  sam: "00000000-0000-0000-0000-000000000005", // senior manager, no access
};
type Who = keyof typeof U;
const S1 = "10000000-0000-4000-8000-000000000001";
const S2 = "10000000-0000-4000-8000-000000000002";
const body = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

let db: PGlite;
let doc: string;
type Status = { can_view: boolean; is_editor?: boolean; version?: number | null; read_version?: number | null; read_version_id?: string | null; read?: boolean };

// a query as a signed-in user (role "authenticated", auth.uid() = that user)
async function as<T = Record<string, unknown>>(who: Who, q: string, params: unknown[] = []): Promise<{ rows?: T[]; error?: string }> {
  await db.exec(`reset role; select set_config('test.uid', '${U[who]}', false); set role authenticated;`);
  try {
    return { rows: (await db.query<T>(q, params)).rows };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    await db.exec("reset role");
  }
}
const status = async (who: Who) => (await as<{ s: Status }>(who, "select sop_my_status() s")).rows![0].s;
const liveText = async (who: Who, section: string) =>
  (await as<{ t: string }>(who, "select s.body_text t from sop_version_sections s join sop_versions v on v.id = s.version_id where s.section_id = $1 order by v.number desc limit 1", [section])).rows?.[0]?.t;

before(async () => {
  db = new PGlite();
  // what Supabase has before our SQL runs
  await db.exec(`
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, full_name text, role text, status text not null default 'active');
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public, auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    grant execute on all functions in schema auth to authenticated;
  `);
  await db.exec(SQL);
  await db.exec(SQL); // safe to run twice
  await db.exec(`insert into profiles values
    ('${U.owner}','Owner','super_admin','active'), ('${U.alice}','Alice','lodge_manager','active'),
    ('${U.bob}','Bob','sales_member','active'), ('${U.cara}','Cara','lodge_accounts','active'),
    ('${U.sam}','Sam','senior_manager','active')`);
  doc = (await db.query<{ id: string }>("select id from sop_documents")).rows[0].id;
  await as("owner", "select sop_grant($1, $2::uuid, null)", [doc, U.alice]);
  await as("owner", "select sop_grant($1, null, 'sales_member')", [doc]);
});

test("the SQL's own check: 7 tables with RLS, 11 functions, 1 SOP, private bucket", async () => {
  const r = await db.query<{ what: string; result: string }>(SQL.slice(SQL.lastIndexOf("select 'tables'")));
  assert.deepEqual(Object.fromEntries(r.rows.map((x) => [x.what, x.result])), { tables: "7", "rls on": "7", functions: "11", documents: "1", "bucket sop-media": "private" });
});

test("auto-publish: an imported SOP never published becomes version 1 when anyone with access opens it, once", async () => {
  // the import (before the one-page SOP): the draft only, nothing published
  const sections = [
    { id: S1, title: "A-1 Check-in", body_json: body("Call the guest."), body_html: "", body_text: "Call the guest." },
    { id: S2, title: "A-2 Stay", body_json: body("Recheck comfort."), body_html: "", body_text: "Recheck comfort." },
  ];
  const imp = await as<{ n: number }>("owner", "select sop_replace_draft($1, $2::jsonb, 'import', '{}'::jsonb) n", [doc, JSON.stringify(sections)]);
  assert.equal(imp.rows?.[0].n, 2, imp.error);
  assert.equal((await status("alice")).version, null, "nothing published yet");
  assert.equal((await as("cara", "select sop_publish_first($1)", [doc])).error?.includes("do not have access"), true, "no access: refused");
  // Alice (staff) opens the SOP first: version 1 appears
  assert.equal((await as<{ n: number }>("alice", "select sop_publish_first($1) n", [doc])).rows?.[0].n, 1);
  assert.equal((await status("alice")).version, 1);
  assert.equal(await liveText("alice", S1), "Call the guest.");
  // once: later calls do nothing
  assert.equal((await as<{ n: number | null }>("bob", "select sop_publish_first($1) n", [doc])).rows?.[0].n, null);
  assert.equal((await as<{ n: number | null }>("owner", "select sop_publish_first($1) n", [doc])).rows?.[0].n, null);
  assert.equal((await as<{ c: number }>("owner", "select count(*)::int c from sop_versions")).rows?.[0].c, 1);
  const s = await status("alice");
  assert.equal(s.read_version, null, "the automatic version 1 does not ask staff to read");
  // the internal publish step cannot be called directly by anyone
  assert.match((await as("alice", "select public.sop__publish($1, 'x', true)", [doc])).error ?? "", /permission denied/);
  assert.match((await as("owner", "select public.sop__publish($1, 'x', true)", [doc])).error ?? "", /permission denied/);
});

test("in-place save goes live at once; the read banner only when 'Ask staff to read' is ticked", async () => {
  // the super admin saves A-1 (what saveSection does: update the section, then sop_publish)
  const upd = await as("owner", "update sop_sections set title = 'A-1 Guest check-in', body_text = 'Call the guest a day prior.' where id = $1 returning id", [S1]);
  assert.equal(upd.rows?.length, 1, upd.error);
  const v2 = await as<{ n: number }>("owner", "select sop_publish($1, 'Edited: A-1 Guest check-in', false) n", [doc]);
  assert.equal(v2.rows?.[0].n, 2, v2.error);
  // live for staff at once, no banner
  assert.equal(await liveText("alice", S1), "Call the guest a day prior.");
  assert.equal(await liveText("bob", S1), "Call the guest a day prior.");
  let s = await status("alice");
  assert.deepEqual([s.version, s.read_version, s.read], [2, null, false], "saved without the tick: no banner");

  // saved again, ticked
  await as("owner", "update sop_sections set body_text = 'Call the guest a day prior and on the day.' where id = $1", [S1]);
  assert.equal((await as<{ n: number }>("owner", "select sop_publish($1, 'Edited: A-1 Guest check-in', true) n", [doc])).rows?.[0].n, 3);
  s = await status("alice");
  assert.deepEqual([s.version, s.read_version, s.read], [3, 3, false], "ticked: staff are asked to read version 3");
  // Alice reads it: her banner goes; Bob still has his
  assert.equal((await as("alice", "insert into sop_reads (version_id, user_id) values ($1, $2) returning user_id", [s.read_version_id, U.alice])).rows?.length, 1);
  assert.equal((await status("alice")).read, true);
  assert.equal((await status("bob")).read, false);
  // a later save without the tick keeps the same question (version 3), no new banner
  assert.equal((await as<{ n: number }>("owner", "select sop_publish($1, 'Moved down: A-2 Stay', false) n", [doc])).rows?.[0].n, 4);
  s = await status("alice");
  assert.deepEqual([s.version, s.read_version, s.read], [4, 3, true]);
  // "Ask staff to read the current SOP" on Access & reading: version 4 now asked, Alice asked again
  assert.equal((await as<{ n: number }>("owner", "select sop_ask_read($1) n", [doc])).rows?.[0].n, 4);
  s = await status("alice");
  assert.deepEqual([s.read_version, s.read], [4, false]);
  // the old versions are kept as they were
  const v1 = await as<{ t: string }>("owner", "select s.body_text t from sop_version_sections s join sop_versions v on v.id = s.version_id where v.number = 1 and s.section_id = $1", [S1]);
  assert.equal(v1.rows?.[0].t, "Call the guest.");
});

test("staff cannot edit: no change to the SOP, no publish, import, restore, reorder, read request or access change", async () => {
  for (const who of ["alice", "bob", "sam", "cara"] as Who[]) {
    const upd = await as(who, "update sop_sections set body_text = 'hacked' returning id");
    assert.equal(upd.rows?.length ?? 0, 0, `${who}: update`);
    assert.ok((await as(who, "insert into sop_sections (document_id, position, title) values ($1, 9, 'x')", [doc])).error, `${who}: insert`);
    assert.equal((await as(who, "delete from sop_sections returning id")).rows?.length ?? 0, 0, `${who}: delete`);
    for (const call of [
      "select sop_publish($1, 'x', true)",
      "select sop_replace_draft($1, '[{\"title\":\"x\",\"body_json\":{}}]'::jsonb, 'import', '{}'::jsonb)",
      "select sop_set_order($1, array[]::uuid[])",
      "select sop_ask_read($1)",
      "select sop_grant($1, null, 'lodge_accounts')",
    ])
      assert.match((await as(who, call, [doc])).error ?? "", /Only the super admin/, `${who}: ${call}`);
    assert.ok((await as(who, "insert into sop_versions (document_id, number, note) values ($1, 99, 'x')", [doc])).error, `${who}: write a version`);
  }
  assert.equal(await liveText("alice", S1), "Call the guest a day prior and on the day.", "unchanged");
  assert.equal((await as<{ c: number }>("alice", "select count(*)::int c from sop_sections")).rows?.[0].c, 0, "staff never see the working copy");
});

test("Access & reading data is for the super admin only: access list, everyone's reads, audit", async () => {
  for (const who of ["alice", "bob", "sam"] as Who[]) {
    assert.equal((await as("alice", "select * from sop_access")).rows?.length, 0, `${who}: access list`);
    assert.equal((await as(who, "select * from sop_audit")).rows?.length, 0, `${who}: audit`);
  }
  assert.equal((await as("bob", "select * from sop_reads")).rows?.length, 0, "Bob cannot see Alice's read");
  assert.equal((await as("alice", "select * from sop_reads")).rows?.length, 1, "Alice sees her own");
  assert.equal((await as("owner", "select * from sop_access")).rows?.length, 2);
  assert.ok(((await as("owner", "select * from sop_reads")).rows?.length ?? 0) >= 1);
  const actions = (await as<{ action: string }>("owner", "select action from sop_audit order by id")).rows!.map((r) => r.action);
  assert.deepEqual([...new Set(actions)].sort(), ["access_grant", "ask_read", "import", "publish"]);
  // no access at all: Cara and Sam see nothing of the SOP
  for (const who of ["cara", "sam"] as Who[]) {
    assert.equal((await status(who)).can_view, false, who);
    assert.equal((await as(who, "select * from sop_versions")).rows?.length, 0, who);
  }
});

test("restore makes an old version live again as a new version; access removed takes effect at once", async () => {
  const v1 = (await db.query<{ id: string }>("select id from sop_versions where number = 1")).rows[0].id;
  const rows = (await db.query<{ id: string; title: string; body_json: unknown; body_text: string }>("select section_id id, title, body_json, body_text from sop_version_sections where version_id = $1 order by position", [v1])).rows;
  assert.equal((await as<{ n: number }>("owner", "select sop_replace_draft($1, $2::jsonb, 'restore', '{\"from_version\":1}'::jsonb) n", [doc, JSON.stringify(rows)])).rows?.[0].n, 2);
  assert.equal((await as<{ n: number }>("owner", "select sop_publish($1, 'Restored version 1', false) n", [doc])).rows?.[0].n, 5);
  assert.equal(await liveText("bob", S1), "Call the guest.");
  const access = (await db.query<{ id: string }>("select id from sop_access where user_id = $1", [U.alice])).rows[0].id;
  await as("owner", "select sop_revoke($1)", [access]);
  assert.equal((await status("alice")).can_view, false);
  assert.equal((await as("alice", "select * from sop_versions")).rows?.length, 0);
});

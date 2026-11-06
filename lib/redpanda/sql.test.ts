// Run with:  npx tsx --test lib/redpanda/sql.test.ts
//
// supabase/red_panda.sql for real, in an in-memory Postgres (PGlite), run twice, with stand-ins
// for what Supabase provides. Checks run as a signed-in user under row level security:
// - the tariff is the sheet's, exactly (60 rates, 12 supplements), and a second run changes nothing;
// - nobody without access reads anything; access by person or by role is enough to read;
// - only the super admin changes rates, text, photos or access; every change is in the audit;
// - existing quotes are 'safari'; a query_type outside safari / red_panda is refused.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(join(__dirname, "..", "..", "supabase", "red_panda.sql"), "utf8");
const U = {
  owner: "00000000-0000-0000-0000-000000000001", // super admin
  sam: "00000000-0000-0000-0000-000000000002", // senior manager, no access
  alice: "00000000-0000-0000-0000-000000000003", // sales member, access by person
  bob: "00000000-0000-0000-0000-000000000004", // sales admin, access by role
  gone: "00000000-0000-0000-0000-000000000005", // sales member with access, deactivated
};
type Who = keyof typeof U;
let db: PGlite;

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

before(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, full_name text, role text, status text not null default 'active');
    create table public.sales_queries (id uuid primary key default gen_random_uuid(), guest_name text, created_at timestamptz not null default now());
    insert into public.sales_queries (guest_name) values ('Old safari quote');
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public, auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    grant all on all tables in schema public to authenticated;
    grant execute on all functions in schema auth to authenticated;
  `);
  await db.exec(`insert into profiles values
    ('${U.owner}','Owner','super_admin','active'), ('${U.sam}','Sam','senior_manager','active'),
    ('${U.alice}','Alice','sales_member','active'), ('${U.bob}','Bob','sales_admin','active'),
    ('${U.gone}','Gone','sales_member','inactive')`);
  await db.exec(SQL.replace(/notify pgrst[^;]*;/, ""));
  await db.exec(SQL.replace(/notify pgrst[^;]*;/, "")); // safe to run twice
  await db.exec(`grant all on all tables in schema public to authenticated`);
});

test("the check select: the expected counts, after two runs", async () => {
  const check = SQL.slice(SQL.lastIndexOf("select\n"));
  const r = (await db.query<Record<string, number>>(check)).rows[0];
  assert.deepEqual(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])), { query_type: 1, tariff: 60, supplements: 12, settings: 1, rls_on: 6, policies: 10 });
});

test("the tariff is the sheet's (spot checks per year, market and group size)", async () => {
  const rate = async (from: string, market: string, guests: number) =>
    Number((await db.query<{ p: string }>("select per_pax p from rp_tariff where valid_from = $1 and market = $2 and guests = $3", [from, market, guests])).rows[0].p);
  assert.equal(await rate("2025-10-01", "b2b", 1), 360000);
  assert.equal(await rate("2025-10-01", "indian", 3), 192500);
  assert.equal(await rate("2025-10-01", "foreign", 7), 178000);
  assert.equal(await rate("2026-10-01", "foreign", 2), 253000);
  assert.equal(await rate("2026-10-01", "indian", 10), 165000);
  assert.equal(await rate("2026-10-01", "b2b", 6), 160000);
  const sup = (await db.query<{ kind: string; market: string; amount: string }>("select kind, market, amount from rp_supplements where valid_from = '2026-10-01' order by kind, market")).rows;
  assert.deepEqual(sup.map((s) => [s.kind, s.market, Number(s.amount)]), [
    ["single_room", "b2b", 60000], ["single_room", "foreign", 70000], ["single_room", "indian", 65000],
    ["tour_leader", "b2b", 45000], ["tour_leader", "foreign", 52000], ["tour_leader", "indian", 48000],
  ]);
});

test("existing quotes are safari; only safari / red_panda allowed", async () => {
  assert.equal((await db.query<{ t: string }>("select query_type t from sales_queries")).rows[0].t, "safari");
  await assert.rejects(db.query("insert into sales_queries (guest_name, query_type) values ('x', 'tiger')"));
});

test("access: nobody without it reads anything; by person or by role is enough; deactivated = none", async () => {
  for (const w of ["sam", "alice", "bob", "gone"] as Who[]) assert.equal((await as(w, "select count(*)::int n from rp_tariff")).rows![0].n, 0, w);
  assert.deepEqual((await as("sam", "select rp_my_access() a")).rows![0].a, { can_use: false, is_editor: false });
  // the senior manager cannot give access
  assert.ok((await as("sam", "insert into rp_access (user_id) values ($1)", [U.sam])).error);
  assert.equal((await as("owner", "insert into rp_access (user_id) values ($1)", [U.alice])).error, undefined);
  assert.equal((await as("owner", "insert into rp_access (role) values ('sales_admin')")).error, undefined);
  assert.equal((await as("owner", "insert into rp_access (user_id) values ($1)", [U.gone])).error, undefined);
  assert.equal((await as("alice", "select count(*)::int n from rp_tariff")).rows![0].n, 60);
  assert.equal((await as("bob", "select count(*)::int n from rp_settings")).rows![0].n, 1);
  assert.equal((await as("gone", "select count(*)::int n from rp_tariff")).rows![0].n, 0);
  assert.equal((await as("sam", "select count(*)::int n from rp_tariff")).rows![0].n, 0);
  assert.deepEqual((await as("alice", "select rp_my_access() a")).rows![0].a, { can_use: true, is_editor: false });
  assert.deepEqual((await as("owner", "select rp_my_access() a")).rows![0].a, { can_use: true, is_editor: true });
  // users with access do not see who else has it, nor the audit
  assert.equal((await as("alice", "select count(*)::int n from rp_access")).rows![0].n, 0);
  assert.equal((await as("alice", "select count(*)::int n from rp_audit")).rows![0].n, 0);
});

test("only the super admin changes Master data; every change is in the audit", async () => {
  const before = Number((await db.query<{ n: string }>("select count(*) n from rp_audit")).rows[0].n);
  // a user with access: the update touches no row (RLS), a new rate is refused
  await as("alice", "update rp_tariff set per_pax = 1 where guests = 1");
  assert.equal(Number((await db.query<{ p: string }>("select per_pax p from rp_tariff where valid_from = '2026-10-01' and market = 'b2b' and guests = 1")).rows[0].p), 395000);
  assert.ok((await as("alice", "insert into rp_images (storage_path) values ('red-panda/x.jpg')")).error);
  // the owner: changed, audited with who
  assert.equal((await as("owner", "update rp_tariff set per_pax = 396000 where valid_from = '2026-10-01' and market = 'b2b' and guests = 1")).error, undefined);
  const a = (await db.query<{ actor: string; old_p: string; new_p: string }>("select actor, old_row->>'per_pax' old_p, new_row->>'per_pax' new_p from rp_audit where table_name = 'rp_tariff' order by id desc limit 1")).rows[0];
  assert.deepEqual([a.actor, Number(a.old_p), Number(a.new_p)], [U.owner, 395000, 396000]);
  assert.ok(Number((await db.query<{ n: string }>("select count(*) n from rp_audit")).rows[0].n) > before);
  // negative money refused
  assert.ok((await as("owner", "update rp_tariff set per_pax = -5 where guests = 2")).error);
  await as("owner", "update rp_tariff set per_pax = 395000 where valid_from = '2026-10-01' and market = 'b2b' and guests = 1");
});

test("a second run does not overwrite a rate the owner changed", async () => {
  await as("owner", "update rp_tariff set per_pax = 400000 where valid_from = '2026-10-01' and market = 'foreign' and guests = 1");
  await db.exec(SQL.replace(/notify pgrst[^;]*;/, ""));
  assert.equal(Number((await db.query<{ p: string }>("select per_pax p from rp_tariff where valid_from = '2026-10-01' and market = 'foreign' and guests = 1")).rows[0].p), 400000);
});

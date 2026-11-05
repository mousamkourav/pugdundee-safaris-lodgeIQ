// Run with:  npx tsx --test lib/sales/payments/sql.test.ts
//
// The payments database rules, for real: supabase/sales_payments.sql runs (twice) in an in-memory
// Postgres (PGlite), with stand-ins for what Supabase has (auth.uid(), profiles, sales_queries, the
// storage buckets table, the authenticated role). Each check runs as a signed-in user under row level
// security, like the app does.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(join(__dirname, "..", "..", "..", "supabase", "sales_payments.sql"), "utf8");
const U = {
  owner: "00000000-0000-0000-0000-000000000001", // super admin
  admin: "00000000-0000-0000-0000-000000000002", // sales admin
  mona: "00000000-0000-0000-0000-000000000003", // sales member
  ravi: "00000000-0000-0000-0000-000000000004", // sales member
  lena: "00000000-0000-0000-0000-000000000005", // lodge manager
  gone: "00000000-0000-0000-0000-000000000006", // sales member, deactivated
};
type Who = keyof typeof U;
const Q_MONA = "20000000-0000-4000-8000-000000000001";
const Q_RAVI = "20000000-0000-4000-8000-000000000002";

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
const ids = async (who: Who, table: string) => ((await as<{ id: string }>(who, `select id from ${table} order by created_at`)).rows ?? []).map((r) => r.id);

let bMona: string;
let bRavi: string;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, full_name text, role text, status text not null default 'active');
    create table public.sales_queries (id uuid primary key, guest_name text, assigned_to uuid, status text, deleted_at timestamptz);
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public, auth, storage to anon, authenticated;
    grant select on storage.buckets to authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    grant all on all tables in schema public to authenticated;
    grant execute on all functions in schema auth to authenticated;
  `);
  await db.exec(SQL);
  await db.exec(SQL); // safe to run twice
  await db.exec(`grant all on all tables in schema public to authenticated;`);
  await db.exec(`insert into profiles values
    ('${U.owner}','Owner','super_admin','active'), ('${U.admin}','Asha','sales_admin','active'),
    ('${U.mona}','Mona','sales_member','active'), ('${U.ravi}','Ravi','sales_member','active'),
    ('${U.lena}','Lena','lodge_manager','active'), ('${U.gone}','Gone','sales_member','inactive');
    insert into sales_queries values ('${Q_MONA}','Marc Burlon','${U.mona}','booked',null), ('${Q_RAVI}','Amy Fine','${U.ravi}','booked',null);`);
  // Mona's booked quote: Mona can create its booking; Ravi's: Ravi
  const one = async (who: Who, q: string, params: unknown[]) => {
    const r = await as<{ id: string }>(who, q, params);
    if (!r.rows?.length) throw new Error(`${who}: ${r.error ?? "no row"}`);
    return r.rows[0].id;
  };
  bMona = await one("mona", `insert into sales_bookings (query_id, guest_name, owner_id, check_in, check_out, source) values ($1,'Marc Burlon',$2,'2026-10-01','2026-10-04','quote') returning id`, [Q_MONA, U.mona]);
  bRavi = await one("ravi", `insert into sales_bookings (query_id, guest_name, owner_id, check_in, check_out, source) values ($1,'Amy Fine',$2,'2026-10-05','2026-10-08','quote') returning id`, [Q_RAVI, U.ravi]);
});

test("the SQL ran twice and made everything", async () => {
  const r = await db.query<Record<string, number>>(SQL.slice(SQL.lastIndexOf("select\n  (select count(*)")));
  const c = r.rows[0];
  assert.deepEqual({ tables: Number(c.tables), rls_on: Number(c.rls_on), policies: Number(c.policies), triggers: Number(c.triggers), bucket: Number(c.bucket) }, { tables: 5, rls_on: 5, policies: 11, triggers: 8, bucket: 1 });
});

test("members see only their own bookings; admins see all; others see none", async () => {
  assert.deepEqual(await ids("mona", "sales_bookings"), [bMona]);
  assert.deepEqual(await ids("ravi", "sales_bookings"), [bRavi]);
  assert.equal((await ids("admin", "sales_bookings")).length, 2);
  assert.equal((await ids("owner", "sales_bookings")).length, 2);
  assert.deepEqual(await ids("lena", "sales_bookings"), []);
  assert.deepEqual(await ids("gone", "sales_bookings"), []);
});

test("a member cannot create a booking for someone else's query or owner", async () => {
  const r = await as("mona", `insert into sales_bookings (query_id, guest_name, owner_id) values ($1,'x',$2)`, [Q_RAVI, U.ravi]);
  assert.match(r.error ?? "", /row-level security/);
  const r2 = await as("lena", `insert into sales_bookings (guest_name, owner_id) values ('x',$1)`, [U.lena]);
  assert.match(r2.error ?? "", /row-level security/);
  // a manual booking of her own: allowed
  const r3 = await as("mona", `insert into sales_bookings (guest_name, owner_id, source) values ('Walk-in guest',$1,'manual') returning id`, [U.mona]);
  assert.ok(r3.rows?.length, r3.error);
});

test("payments: the booking's member adds and corrects them, with the reason in the history; others cannot", async () => {
  const p = await as<{ id: string }>("mona", `insert into sales_booking_payments (booking_id, amount, paid_on, mode, change_reason) values ($1, 161500, '2026-09-03', 'bank_transfer', null) returning id`, [bMona]);
  assert.ok(p.rows?.length, p.error);
  const pid = p.rows![0].id;
  const up = await as("mona", `update sales_booking_payments set amount = 161000, change_reason = 'typo in amount' where id = $1`, [pid]);
  assert.equal(up.error, undefined);
  // Ravi cannot see, add to or change Mona's booking
  assert.deepEqual(await ids("ravi", "sales_booking_payments"), []);
  const r = await as("ravi", `insert into sales_booking_payments (booking_id, amount, paid_on) values ($1, 100, '2026-09-03')`, [bMona]);
  assert.match(r.error ?? "", /row-level security/);
  const r2 = await as<{ id: string }>("ravi", `update sales_booking_payments set amount = 1 where id = $1 returning id`, [pid]);
  assert.deepEqual(r2.rows, []);
  // a member cannot hard-delete (the app sets deleted_at with a reason); an admin can
  const del = await as<{ id: string }>("mona", `delete from sales_booking_payments where id = $1 returning id`, [pid]);
  assert.deepEqual(del.rows, []);
  const soft = await as("mona", `update sales_booking_payments set deleted_at = now(), change_reason = 'entered twice' where id = $1`, [pid]);
  assert.equal(soft.error, undefined);
  // the history: insert, the correction and the removal, each with who and why
  const audit = (await as<{ action: string; reason: string | null; actor: string }>("mona", `select action, reason, actor from sales_booking_audit where table_name = 'sales_booking_payments' and row_id = $1 order by id`, [pid])).rows!;
  assert.deepEqual(audit.map((a) => [a.action, a.reason, a.actor]), [["insert", null, U.mona], ["update", "typo in amount", U.mona], ["update", "entered twice", U.mona]]);
  // nobody writes the history by hand
  const fake = await as("owner", `insert into sales_booking_audit (booking_id, table_name, action) values ($1, 'x', 'insert')`, [bMona]);
  assert.match(fake.error ?? "", /row-level security/);
});

test("money is never negative or text", async () => {
  const neg = await as("admin", `insert into sales_booking_payments (booking_id, amount, paid_on) values ($1, -5, '2026-09-03')`, [bMona]);
  assert.match(neg.error ?? "", /check constraint/);
  const zero = await as("admin", `insert into sales_booking_payments (booking_id, amount, paid_on) values ($1, 0, '2026-09-03')`, [bMona]);
  assert.match(zero.error ?? "", /check constraint/);
  const text = await as("admin", `insert into sales_booking_payments (booking_id, amount, paid_on) values ($1, 'abc', '2026-09-03')`, [bMona]);
  assert.match(text.error ?? "", /invalid input syntax/);
  const line = await as("admin", `insert into sales_booking_lines (booking_id, room_amount) values ($1, -1)`, [bMona]);
  assert.match(line.error ?? "", /check constraint/);
  const mode = await as("admin", `insert into sales_booking_payments (booking_id, amount, paid_on, mode) values ($1, 10, '2026-09-03', 'bitcoin')`, [bMona]);
  assert.match(mode.error ?? "", /check constraint/);
});

test("one booking per query; only admins delete a booking", async () => {
  const dup = await as("mona", `insert into sales_bookings (query_id, guest_name, owner_id) values ($1,'Marc again',$2)`, [Q_MONA, U.mona]);
  assert.match(dup.error ?? "", /duplicate key/);
  const del = await as<{ id: string }>("mona", `delete from sales_bookings where id = $1 returning id`, [bMona]);
  assert.deepEqual(del.rows, []);
  const delAdmin = await as<{ id: string }>("admin", `delete from sales_bookings where id = $1 returning id`, [bRavi]);
  assert.equal(delAdmin.rows?.length, 1);
});

-- =====================================================================
-- Payments tracker (Sales > Payments), replaces the payments Excel. 5 Nov 2026.
--   sales_bookings          one per booked quote (made when a query is marked Booked) or added by
--                           hand / imported: guest, dates, salesperson, extra amounts, cancelled
--   sales_booking_lines     each lodge booking of it: lodge, Djubo booking no., dates, rooms, nights,
--                           room / safari / transfer / other amounts (incl. GST)
--   sales_booking_dues      when money is due (from the quote's payment schedule; editable)
--   sales_booking_payments  payments, refunds and cancellation charges (soft-deleted, never lost)
--   sales_booking_audit     every insert / change / delete of the four tables above, with who,
--                           when, the old and new row and the reason (written by a trigger)
-- Who sees what (row level security, the real guard):
--   super_admin, senior_manager, sales_admin (active): every booking;
--   sales_member (active): the bookings of queries assigned to them and bookings they own;
--   members change the payments of their own bookings (the app asks a reason); only admins delete
--   a booking. Nobody writes the audit table directly.
-- Private storage bucket "sales-payments" for payment attachments (the app reads it with the
-- service key after checking access).
-- Safe to run more than once. Run any time (before the deploy, Payments shows "run the SQL").
-- One DO block for the Supabase SQL Editor; the select at the end shows the result.
-- =====================================================================
do $pay$
declare
  qt text;
begin
  -- the type of sales_queries.id (uuid on Supabase), so the foreign key matches
  select format_type(a.atttypid, a.atttypmod) into qt
  from pg_attribute a where a.attrelid = 'public.sales_queries'::regclass and a.attname = 'id';

  -- ------------------------------------------------------------------ tables
  execute format($t$
    create table if not exists public.sales_bookings (
      id              uuid primary key default gen_random_uuid(),
      query_id        %1$s references public.sales_queries(id) on delete set null,
      version_no      integer,
      guest_name      text not null check (length(btrim(guest_name)) between 1 and 200),
      owner_id        uuid references public.profiles(id) on delete set null,
      check_in        date,
      check_out       date,
      currency        text not null default 'INR' check (currency in ('INR','USD','EUR','GBP','AUD')),
      other_amount    numeric(14,2) not null default 0 check (other_amount >= 0 and other_amount <= 100000000),
      discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0 and discount_amount <= 100000000),
      booked_on       date,
      cancelled       boolean not null default false,
      cancelled_on    date,
      source          text not null default 'manual' check (source in ('quote','manual','import')),
      notes           text check (notes is null or length(notes) <= 2000),
      change_reason   text check (change_reason is null or length(change_reason) <= 500),
      created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
      created_at      timestamptz not null default now(),
      updated_at      timestamptz not null default now(),
      deleted_at      timestamptz,
      check (check_out is null or check_in is null or check_out >= check_in)
    )$t$, qt);
  create unique index if not exists sales_bookings_one_per_query on public.sales_bookings (query_id) where query_id is not null and deleted_at is null;
  create index if not exists sales_bookings_check_in on public.sales_bookings (check_in) where deleted_at is null;
  create index if not exists sales_bookings_owner on public.sales_bookings (owner_id) where deleted_at is null;

  create table if not exists public.sales_booking_lines (
    id              uuid primary key default gen_random_uuid(),
    booking_id      uuid not null references public.sales_bookings(id) on delete cascade,
    lodge_name      text not null default '' check (length(lodge_name) <= 200),
    property_id     uuid,
    booking_no      text check (booking_no is null or length(booking_no) <= 40),
    check_in        date,
    check_out       date,
    rooms           integer not null default 1 check (rooms between 0 and 100),
    nights          integer not null default 0 check (nights between 0 and 1000),
    room_amount     numeric(14,2) not null default 0 check (room_amount >= 0 and room_amount <= 100000000),
    safari_amount   numeric(14,2) not null default 0 check (safari_amount >= 0 and safari_amount <= 100000000),
    transfer_amount numeric(14,2) not null default 0 check (transfer_amount >= 0 and transfer_amount <= 100000000),
    other_amount    numeric(14,2) not null default 0 check (other_amount >= 0 and other_amount <= 100000000),
    sort            integer not null default 0,
    change_reason   text check (change_reason is null or length(change_reason) <= 500),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    check (check_out is null or check_in is null or check_out >= check_in)
  );
  create index if not exists sales_booking_lines_booking on public.sales_booking_lines (booking_id, sort);
  create index if not exists sales_booking_lines_no on public.sales_booking_lines (booking_no);

  create table if not exists public.sales_booking_dues (
    id            uuid primary key default gen_random_uuid(),
    booking_id    uuid not null references public.sales_bookings(id) on delete cascade,
    label         text not null default '' check (length(label) <= 200),
    due_on        date not null,
    amount        numeric(14,2) not null check (amount >= 0 and amount <= 100000000),
    sort          integer not null default 0,
    change_reason text check (change_reason is null or length(change_reason) <= 500),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
  );
  create index if not exists sales_booking_dues_booking on public.sales_booking_dues (booking_id, due_on);

  create table if not exists public.sales_booking_payments (
    id              uuid primary key default gen_random_uuid(),
    booking_id      uuid not null references public.sales_bookings(id) on delete cascade,
    line_id         uuid references public.sales_booking_lines(id) on delete set null,
    kind            text not null default 'payment' check (kind in ('payment','refund','cancellation_charge')),
    amount          numeric(14,2) not null check (amount > 0 and amount <= 100000000),
    paid_on         date,
    mode            text not null default 'other' check (mode in ('bank_transfer','upi','card','cash','website','payment_link','agent','other')),
    reference       text check (reference is null or length(reference) <= 200),
    received_by     text check (received_by is null or length(received_by) <= 120),
    note            text check (note is null or length(note) <= 1000),
    attachment_path text check (attachment_path is null or length(attachment_path) <= 300),
    change_reason   text check (change_reason is null or length(change_reason) <= 500),
    created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz
  );
  create index if not exists sales_booking_payments_booking on public.sales_booking_payments (booking_id) where deleted_at is null;
  create index if not exists sales_booking_payments_paid_on on public.sales_booking_payments (paid_on) where deleted_at is null;

  create table if not exists public.sales_booking_audit (
    id          bigint generated always as identity primary key,
    booking_id  uuid,
    table_name  text not null,
    row_id      uuid,
    action      text not null check (action in ('insert','update','delete')),
    old_row     jsonb,
    new_row     jsonb,
    reason      text,
    actor       uuid default auth.uid(),
    at          timestamptz not null default now()
  );
  create index if not exists sales_booking_audit_booking on public.sales_booking_audit (booking_id, at desc);

  -- ------------------------------------------------------------------ functions
  -- a Sales admin (sees and changes every booking)
  create or replace function public.sales_pay_is_admin()
  returns boolean language sql stable security definer set search_path = public as $f$
    select coalesce((select p.role in ('super_admin','senior_manager','sales_admin') and coalesce(p.status, 'active') = 'active'
                     from public.profiles p where p.id = auth.uid()), false);
  $f$;

  -- a booking row: admins any; an active sales member when they own it or its query is assigned
  -- to them (read from the row itself, so a new row passes too)
  execute format($t$
    create or replace function public.sales_pay_can_row(p_owner uuid, p_query %1$s)
    returns boolean language sql stable security definer set search_path = public as $f$
      select public.sales_pay_is_admin() or (
        exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'sales_member' and coalesce(p.status, 'active') = 'active')
        and (p_owner = auth.uid() or exists (select 1 from public.sales_queries q where q.id = p_query and q.assigned_to = auth.uid()))
      );
    $f$$t$, qt);

  -- may the signed-in user see / change this booking? (see sales_pay_can_row)
  create or replace function public.sales_pay_can(p_booking uuid)
  returns boolean language sql stable security definer set search_path = public as $f$
    select public.sales_pay_is_admin() or exists (
      select 1 from public.sales_bookings b where b.id = p_booking and public.sales_pay_can_row(b.owner_id, b.query_id)
    );
  $f$;

  -- every change of a booking, its lines, dues and payments, with the reason given in the app
  create or replace function public.sales_pay_audit()
  returns trigger language plpgsql security definer set search_path = public as $f$
  declare
    b uuid;
  begin
    if tg_table_name = 'sales_bookings' then
      b := coalesce(new.id, old.id);
    else
      b := coalesce(new.booking_id, old.booking_id);
    end if;
    insert into public.sales_booking_audit (booking_id, table_name, row_id, action, old_row, new_row, reason, actor)
    values (
      b, tg_table_name, coalesce(new.id, old.id), lower(tg_op),
      case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
      case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
      case when tg_op in ('INSERT','UPDATE') then new.change_reason else old.change_reason end,
      auth.uid()
    );
    return coalesce(new, old);
  end $f$;

  create or replace function public.sales_pay_touch()
  returns trigger language plpgsql as $f$
  begin
    new.updated_at := now();
    return new;
  end $f$;

  -- ------------------------------------------------------------------ triggers
  drop trigger if exists sales_bookings_audit on public.sales_bookings;
  create trigger sales_bookings_audit after insert or update or delete on public.sales_bookings for each row execute function public.sales_pay_audit();
  drop trigger if exists sales_booking_lines_audit on public.sales_booking_lines;
  create trigger sales_booking_lines_audit after insert or update or delete on public.sales_booking_lines for each row execute function public.sales_pay_audit();
  drop trigger if exists sales_booking_dues_audit on public.sales_booking_dues;
  create trigger sales_booking_dues_audit after insert or update or delete on public.sales_booking_dues for each row execute function public.sales_pay_audit();
  drop trigger if exists sales_booking_payments_audit on public.sales_booking_payments;
  create trigger sales_booking_payments_audit after insert or update or delete on public.sales_booking_payments for each row execute function public.sales_pay_audit();
  drop trigger if exists sales_bookings_touch on public.sales_bookings;
  create trigger sales_bookings_touch before update on public.sales_bookings for each row execute function public.sales_pay_touch();
  drop trigger if exists sales_booking_lines_touch on public.sales_booking_lines;
  create trigger sales_booking_lines_touch before update on public.sales_booking_lines for each row execute function public.sales_pay_touch();
  drop trigger if exists sales_booking_dues_touch on public.sales_booking_dues;
  create trigger sales_booking_dues_touch before update on public.sales_booking_dues for each row execute function public.sales_pay_touch();
  drop trigger if exists sales_booking_payments_touch on public.sales_booking_payments;
  create trigger sales_booking_payments_touch before update on public.sales_booking_payments for each row execute function public.sales_pay_touch();

  -- ------------------------------------------------------------------ row level security
  alter table public.sales_bookings enable row level security;
  alter table public.sales_booking_lines enable row level security;
  alter table public.sales_booking_dues enable row level security;
  alter table public.sales_booking_payments enable row level security;
  alter table public.sales_booking_audit enable row level security;

  drop policy if exists sales_bookings_select on public.sales_bookings;
  create policy sales_bookings_select on public.sales_bookings for select to authenticated using (public.sales_pay_can_row(owner_id, query_id));
  drop policy if exists sales_bookings_insert on public.sales_bookings;
  create policy sales_bookings_insert on public.sales_bookings for insert to authenticated with check (public.sales_pay_can_row(owner_id, query_id));
  drop policy if exists sales_bookings_update on public.sales_bookings;
  create policy sales_bookings_update on public.sales_bookings for update to authenticated
    using (public.sales_pay_can_row(owner_id, query_id)) with check (public.sales_pay_can_row(owner_id, query_id));
  drop policy if exists sales_bookings_delete on public.sales_bookings;
  create policy sales_bookings_delete on public.sales_bookings for delete to authenticated using (public.sales_pay_is_admin());

  -- lines, dues and payments: whoever may see / change the booking; hard deletes for admins only
  -- (payments are removed by setting deleted_at, so the record and its reason stay)
  drop policy if exists sales_booking_lines_all on public.sales_booking_lines;
  create policy sales_booking_lines_all on public.sales_booking_lines for all to authenticated
    using (public.sales_pay_can(booking_id)) with check (public.sales_pay_can(booking_id));
  drop policy if exists sales_booking_dues_all on public.sales_booking_dues;
  create policy sales_booking_dues_all on public.sales_booking_dues for all to authenticated
    using (public.sales_pay_can(booking_id)) with check (public.sales_pay_can(booking_id));
  drop policy if exists sales_booking_payments_select on public.sales_booking_payments;
  create policy sales_booking_payments_select on public.sales_booking_payments for select to authenticated using (public.sales_pay_can(booking_id));
  drop policy if exists sales_booking_payments_insert on public.sales_booking_payments;
  create policy sales_booking_payments_insert on public.sales_booking_payments for insert to authenticated with check (public.sales_pay_can(booking_id));
  drop policy if exists sales_booking_payments_update on public.sales_booking_payments;
  create policy sales_booking_payments_update on public.sales_booking_payments for update to authenticated
    using (public.sales_pay_can(booking_id)) with check (public.sales_pay_can(booking_id));
  drop policy if exists sales_booking_payments_delete on public.sales_booking_payments;
  create policy sales_booking_payments_delete on public.sales_booking_payments for delete to authenticated using (public.sales_pay_is_admin());

  -- the history: read where the booking can be read; written only by the trigger
  drop policy if exists sales_booking_audit_select on public.sales_booking_audit;
  create policy sales_booking_audit_select on public.sales_booking_audit for select to authenticated using (public.sales_pay_can(booking_id));

  -- ------------------------------------------------------------------ attachments bucket (private)
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('sales-payments', 'sales-payments', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$pay$;

notify pgrst, 'reload schema';

-- Check (expected: tables 5, rls_on 5, policies 11, triggers 8, bucket 1)
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('sales_bookings','sales_booking_lines','sales_booking_dues','sales_booking_payments','sales_booking_audit')) as tables,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity
     and c.relname in ('sales_bookings','sales_booking_lines','sales_booking_dues','sales_booking_payments','sales_booking_audit')) as rls_on,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename in ('sales_bookings','sales_booking_lines','sales_booking_dues','sales_booking_payments','sales_booking_audit')) as policies,
  (select count(*) from pg_trigger where not tgisinternal and tgname like 'sales_book%') as triggers,
  (select count(*) from storage.buckets where id = 'sales-payments') as bucket;

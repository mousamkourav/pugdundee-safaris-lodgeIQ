-- =============================================================================
-- LodgeIQ — Supabase / PostgreSQL schema  (MVP)
-- Run this in: Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Design choices baked in:
--   * Roles: super_admin > general_manager > resort_manager (extensible)
--   * Multi-lodge with Row-Level Security (lodge-scoped access)
--   * DAILY fact tables (entry_date) that roll up to monthly reports
--   * FULL payroll (attendance-driven, advances, leaves, deductions)
--   * Every table has an `extra jsonb` column for future fields (no migration needed)
-- Controlled vocab uses TEXT + CHECK (easy to extend) instead of enums.
-- =============================================================================

create extension if not exists pgcrypto;      -- gen_random_uuid()

-- -----------------------------------------------------------------------------
-- 0. Utility: updated_at trigger function
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- =============================================================================
-- 1. IDENTITY & ACCESS
-- =============================================================================

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text not null default 'resort_manager'
              check (role in ('super_admin','general_manager','resort_manager',
                              'department_head','accounts','viewer')),
  phone       text,
  status      text not null default 'active' check (status in ('active','disabled')),
  extra       jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.lodges (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text,
  room_count  int,
  capacity    int,
  status      text not null default 'active' check (status in ('active','inactive')),
  config      jsonb not null default '{}',
  extra       jsonb not null default '{}',
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Which non-admin users can access which lodges. (Admins see all lodges.)
create table public.user_lodge_access (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  lodge_id   uuid not null references public.lodges(id)  on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, lodge_id)
);

-- Auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Access helper functions (used by RLS). SECURITY DEFINER to read profiles.
-- -----------------------------------------------------------------------------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() = 'super_admin';
$$;

create or replace function public.is_admin()      -- super_admin OR general_manager
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('super_admin','general_manager');
$$;

create or replace function public.has_lodge_access(l uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.user_lodge_access
                 where user_id = auth.uid() and lodge_id = l);
$$;

-- =============================================================================
-- 2. PLATFORM: attachments, notifications, audit
-- =============================================================================

create table public.attachments (
  id          uuid primary key default gen_random_uuid(),
  lodge_id    uuid references public.lodges(id) on delete cascade,
  module      text,                      -- e.g. 'purchases','staff_salary','photos'
  record_id   uuid,                      -- the row this file belongs to
  file_path   text not null,             -- path in Supabase Storage bucket
  file_name   text,
  uploaded_by uuid references public.profiles(id),
  extra       jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  lodge_id    uuid references public.lodges(id) on delete cascade,
  type        text not null,             -- 'service_due','bar_rate_change','report_reminder','low_stock','expense_anomaly'
  severity    text not null default 'info' check (severity in ('critical','warning','info')),
  title       text not null,
  body        text,
  channels    text[] not null default '{inapp}',   -- {inapp,email,whatsapp}
  target_user uuid references public.profiles(id),
  status      text not null default 'pending' check (status in ('pending','sent','failed','read')),
  sent_at     timestamptz,
  extra       jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create table public.notification_rules (
  id         uuid primary key default gen_random_uuid(),
  lodge_id   uuid references public.lodges(id) on delete cascade,  -- null = global
  rule_type  text not null,              -- 'service_due','bar_rate_change', etc.
  config     jsonb not null default '{}',-- thresholds, lead days, recipients
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor      uuid references public.profiles(id),
  action     text,                       -- 'insert','update','delete'
  table_name text,
  record_id  uuid,
  diff       jsonb,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 3. FRONT OFFICE & REVENUE  (daily)   — sheet Section 1
-- =============================================================================

create table public.occupancy_daily (
  id                 uuid primary key default gen_random_uuid(),
  lodge_id           uuid not null references public.lodges(id) on delete cascade,
  entry_date         date not null,
  rooms_paid         int  not null default 0,
  rooms_comp         int  not null default 0,
  adults             int  not null default 0,
  children_5_12      int  not null default 0,
  children_below_5   int  not null default 0,
  total_pax          int  generated always as (adults + children_5_12 + children_below_5) stored,
  extra              jsonb not null default '{}',
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (lodge_id, entry_date)
);

create table public.extra_sales (
  id         uuid primary key default gen_random_uuid(),
  lodge_id   uuid not null references public.lodges(id) on delete cascade,
  entry_date date not null,
  line_item  text not null,   -- nature_shop, spa, beverages_soft, beverages_alcohol, corkage, laundry, extra_food, activities, transport
  amount     numeric(12,2) not null default 0,
  remarks    text,
  extra      jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ratings (
  id             uuid primary key default gen_random_uuid(),
  lodge_id       uuid not null references public.lodges(id) on delete cascade,
  entry_date     date not null,
  source         text not null check (source in ('tripadvisor','google')),
  score          numeric(2,1),
  positive_count int default 0,
  negative_count int default 0,
  extra          jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.travel_agents (
  id         uuid primary key default gen_random_uuid(),
  lodge_id   uuid not null references public.lodges(id) on delete cascade,
  entry_date date,
  agency     text not null,
  contact    text,
  extra      jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- 4. EXPENDITURE  (daily)   — sheet Sections 2,3,4
-- =============================================================================

create table public.expenses (
  id                 uuid primary key default gen_random_uuid(),
  lodge_id           uuid not null references public.lodges(id) on delete cascade,
  entry_date         date not null,
  category           text not null check (category in ('fnb','misc','housekeeping')),
  line_item          text not null,      -- meat, dairy, vegetables, lpg, petrol, diesel, maintenance_electric, laundry, ...
  amount             numeric(12,2) not null default 0,
  remarks            text,
  bill_attachment_id uuid references public.attachments(id),
  extra              jsonb not null default '{}',
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on public.expenses (lodge_id, entry_date, category);

-- =============================================================================
-- 5. ENERGY & VEHICLES  (daily)   — sheet Sections 5,6
-- =============================================================================

create table public.energy_readings (
  id            uuid primary key default gen_random_uuid(),
  lodge_id      uuid not null references public.lodges(id) on delete cascade,
  entry_date    date not null,
  asset         text not null,           -- dg_125, dg_30, electricity, solar
  opening       numeric(14,2),
  closing       numeric(14,2),
  net_usage     numeric(14,2),
  fuel_litres   numeric(12,2),
  cost_rs       numeric(12,2),
  rate_per_ltr  numeric(10,2),
  per_hour_cost numeric(12,2),
  notes         text,
  extra         jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.vehicles (
  id         uuid primary key default gen_random_uuid(),
  lodge_id   uuid not null references public.lodges(id) on delete cascade,
  vehicle_no text not null,
  label      text,                        -- 'Isuzu', 'New Gypsy', 'Bike'
  active     boolean not null default true,
  extra      jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vehicle_logs (
  id          uuid primary key default gen_random_uuid(),
  lodge_id    uuid not null references public.lodges(id) on delete cascade,
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  entry_date  date not null,
  opening_km  numeric(12,1),
  closing_km  numeric(12,1),
  run_km      numeric(12,1) generated always as (closing_km - opening_km) stored,
  fuel_ltr    numeric(10,2),
  cost_rs     numeric(12,2),
  rate        numeric(10,2),
  extra       jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- =============================================================================
-- 6. ASSETS & SERVICE LOG   — sheet Section 7 (drives expiry notifications)
-- =============================================================================

create table public.assets (
  id                     uuid primary key default gen_random_uuid(),
  lodge_id               uuid not null references public.lodges(id) on delete cascade,
  name                   text not null,   -- 'Fire Extinguisher','Pool filter','DG 125 KVA',...
  category               text,
  criticality            text not null default 'normal' check (criticality in ('safety','normal')),
  service_interval_months int,            -- null = ad-hoc
  extra                  jsonb not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.service_records (
  id           uuid primary key default gen_random_uuid(),
  lodge_id     uuid not null references public.lodges(id) on delete cascade,
  asset_id     uuid not null references public.assets(id) on delete cascade,
  service_date date not null,
  next_due     date,                       -- auto-filled by trigger from interval
  notes        text,
  extra        jsonb not null default '{}',
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- compute next_due = service_date + interval months
create or replace function public.set_service_next_due()
returns trigger language plpgsql as $$
declare mths int;
begin
  select service_interval_months into mths from public.assets where id = new.asset_id;
  if mths is not null then
    new.next_due := (new.service_date + (mths || ' months')::interval)::date;
  end if;
  return new;
end $$;

create trigger trg_service_next_due
  before insert or update on public.service_records
  for each row execute function public.set_service_next_due();

-- =============================================================================
-- 7. STAFF + FULL PAYROLL   — sheet Section 8 + new asks
-- =============================================================================

create table public.staff (
  id           uuid primary key default gen_random_uuid(),
  lodge_id     uuid not null references public.lodges(id) on delete cascade,
  full_name    text not null,
  role_title   text,
  phone        text,
  join_date    date,
  status       text not null default 'active' check (status in ('active','left')),
  leave_date   date,
  leave_reason text,
  monthly_ctc  numeric(12,2) default 0,    -- base monthly salary
  extra        jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.staff_attendance (
  id         uuid primary key default gen_random_uuid(),
  lodge_id   uuid not null references public.lodges(id) on delete cascade,
  staff_id   uuid not null references public.staff(id) on delete cascade,
  date       date not null,
  status     text not null check (status in ('present','absent','paid_leave','unpaid_leave','half_day','week_off')),
  hours      numeric(4,1),
  notes      text,
  extra      jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, date)
);

create table public.staff_advances (
  id             uuid primary key default gen_random_uuid(),
  lodge_id       uuid not null references public.lodges(id) on delete cascade,
  staff_id       uuid not null references public.staff(id) on delete cascade,
  amount         numeric(12,2) not null,
  advance_date   date not null,
  reason         text,
  recovered      boolean not null default false,
  recovery_month date,                      -- which payroll month it is deducted in
  extra          jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Monthly payroll run per staff. Store `month` as first day of month.
create table public.payroll (
  id                 uuid primary key default gen_random_uuid(),
  lodge_id           uuid not null references public.lodges(id) on delete cascade,
  staff_id           uuid not null references public.staff(id) on delete cascade,
  month              date not null,          -- e.g. 2025-10-01
  base_salary        numeric(12,2) not null default 0,
  present_days       numeric(5,1) default 0,
  paid_leave_days    numeric(5,1) default 0,
  unpaid_leave_days  numeric(5,1) default 0,
  overtime_amount    numeric(12,2) default 0,
  allowances         numeric(12,2) default 0,
  deductions         numeric(12,2) default 0,   -- fines, PF, other
  advance_deducted   numeric(12,2) default 0,
  gross              numeric(12,2) generated always as (base_salary + overtime_amount + allowances) stored,
  net_payable        numeric(12,2) generated always as
                        (base_salary + overtime_amount + allowances - deductions - advance_deducted) stored,
  paid               boolean not null default false,
  paid_on            date,
  payslip_attachment_id uuid references public.attachments(id),
  notes              text,
  extra              jsonb not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (staff_id, month)
);

-- =============================================================================
-- 8. BAR / LIQUOR   — new ask (rate-change notification)
-- =============================================================================

create table public.bar_items (
  id            uuid primary key default gen_random_uuid(),
  lodge_id      uuid not null references public.lodges(id) on delete cascade,
  name          text not null,
  category      text,
  unit          text,                       -- bottle, peg, ml
  current_rate  numeric(10,2) not null default 0,
  current_stock numeric(12,2) not null default 0,
  reorder_level numeric(12,2) default 0,
  extra         jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.bar_rate_history (
  id         uuid primary key default gen_random_uuid(),
  lodge_id   uuid not null references public.lodges(id) on delete cascade,
  item_id    uuid not null references public.bar_items(id) on delete cascade,
  old_rate   numeric(10,2),
  new_rate   numeric(10,2),
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);

create table public.bar_stock_movements (
  id         uuid primary key default gen_random_uuid(),
  lodge_id   uuid not null references public.lodges(id) on delete cascade,
  item_id    uuid not null references public.bar_items(id) on delete cascade,
  type       text not null check (type in ('purchase','sale','wastage','transfer','adjustment')),
  qty        numeric(12,2) not null,
  rate       numeric(10,2),
  date       date not null,
  notes      text,
  extra      jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- When a bar item's rate changes, log it + raise a notification.
create or replace function public.on_bar_rate_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.current_rate is distinct from old.current_rate then
    insert into public.bar_rate_history(lodge_id, item_id, old_rate, new_rate, changed_by)
    values (new.lodge_id, new.id, old.current_rate, new.current_rate, auth.uid());

    insert into public.notifications(lodge_id, type, severity, title, body, channels)
    values (new.lodge_id, 'bar_rate_change', 'warning',
            'Bar rate changed: ' || new.name,
            format('%s rate changed from %s to %s', new.name, old.current_rate, new.current_rate),
            '{inapp,email,whatsapp}');
  end if;
  return new;
end $$;

create trigger trg_bar_rate_change
  after update on public.bar_items
  for each row execute function public.on_bar_rate_change();

-- =============================================================================
-- 9. STOCK & PURCHASES   — new ask (bill upload)
-- =============================================================================

create table public.stock_items (
  id            uuid primary key default gen_random_uuid(),
  lodge_id      uuid not null references public.lodges(id) on delete cascade,
  name          text not null,
  category      text,
  unit          text,
  current_qty   numeric(12,2) not null default 0,
  reorder_level numeric(12,2) default 0,
  extra         jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.purchases (
  id                 uuid primary key default gen_random_uuid(),
  lodge_id           uuid not null references public.lodges(id) on delete cascade,
  item_id            uuid references public.stock_items(id),
  item_name          text,                 -- free text if not a tracked item
  qty                numeric(12,2) not null default 0,
  rate               numeric(12,2) not null default 0,
  amount             numeric(14,2) generated always as (qty * rate) stored,
  vendor             text,
  purchase_date      date not null,
  bill_attachment_id uuid references public.attachments(id),
  notes              text,
  extra              jsonb not null default '{}',
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.stock_movements (
  id         uuid primary key default gen_random_uuid(),
  lodge_id   uuid not null references public.lodges(id) on delete cascade,
  item_id    uuid not null references public.stock_items(id) on delete cascade,
  type       text not null check (type in ('purchase','issue','wastage','transfer','adjustment')),
  qty        numeric(12,2) not null,
  date       date not null,
  notes      text,
  extra      jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 10. SAFARI / TICKETS / GUEST EXP / ACCOUNTS / SIMPLE STOCK  — Sections 10-13
-- =============================================================================

create table public.safari_usage (
  id                  uuid primary key default gen_random_uuid(),
  lodge_id            uuid not null references public.lodges(id) on delete cascade,
  entry_date          date not null,
  our_turn            int default 0,
  against_waiting     int default 0,
  union_gypsy         int default 0,
  total_safaris       int default 0,
  full_day            int default 0,
  outside_pickup_drop int default 0,
  isuzu_pickup_drop   int default 0,
  outside_guest       int default 0,
  remarks             text,
  extra               jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.ticket_usage (
  id                  uuid primary key default gen_random_uuid(),
  lodge_id            uuid not null references public.lodges(id) on delete cascade,
  entry_date          date not null,
  delhi_used          int default 0,
  gate_taken          int default 0,
  boat                int default 0,
  total_used          int default 0,
  by_guest            int default 0,
  delhi_unused        int default 0,
  guide_fees_regular  numeric(12,2) default 0,
  guide_fees_fullday  numeric(12,2) default 0,
  park_bans           text,
  extra               jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.guest_experiences (
  id                 uuid primary key default gen_random_uuid(),
  lodge_id           uuid not null references public.lodges(id) on delete cascade,
  entry_date         date not null,
  experience_dinners boolean default false,
  presentations      boolean default false,
  private_dinners    boolean default false,
  notes              text,
  extra              jsonb not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.accounts_status (
  id                  uuid primary key default gen_random_uuid(),
  lodge_id            uuid not null references public.lodges(id) on delete cascade,
  month               date not null,        -- first day of month
  sales_entered       boolean default false,
  petty_cash_entered  boolean default false,
  expenses_entered    boolean default false,
  remarks             text,
  extra               jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (lodge_id, month)
);

create table public.simple_stock (
  id         uuid primary key default gen_random_uuid(),
  lodge_id   uuid not null references public.lodges(id) on delete cascade,
  month      date not null,
  item       text not null,                 -- e.g. 'Steel bottles'
  opening    numeric(12,2) default 0,
  used       numeric(12,2) default 0,
  closing    numeric(12,2) default 0,
  extra      jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- 11. MONTHLY REPORT
-- =============================================================================

create table public.monthly_reports (
  id               uuid primary key default gen_random_uuid(),
  lodge_id         uuid not null references public.lodges(id) on delete cascade,
  month            date not null,           -- first day of month
  status           text not null default 'draft' check (status in ('draft','submitted','reviewed')),
  submitted_by     uuid references public.profiles(id),
  submitted_at     timestamptz,
  reviewed_by      uuid references public.profiles(id),
  generated_pdf_path text,
  extra            jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (lodge_id, month)
);

-- =============================================================================
-- 12. updated_at triggers on every table that has the column
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','lodges','notification_rules','occupancy_daily','extra_sales','ratings',
    'travel_agents','expenses','energy_readings','vehicles','vehicle_logs','assets',
    'service_records','staff','staff_attendance','staff_advances','payroll','bar_items',
    'stock_items','purchases','safari_usage','ticket_usage','guest_experiences',
    'accounts_status','simple_stock','monthly_reports'
  ] loop
    execute format(
      'create trigger trg_updated_at before update on public.%I
         for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- =============================================================================
-- 13. ROW-LEVEL SECURITY
-- =============================================================================

-- 13a. Enable RLS on everything
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','lodges','user_lodge_access','attachments','notifications',
    'notification_rules','audit_log','occupancy_daily','extra_sales','ratings',
    'travel_agents','expenses','energy_readings','vehicles','vehicle_logs','assets',
    'service_records','staff','staff_attendance','staff_advances','payroll','bar_items',
    'bar_rate_history','bar_stock_movements','stock_items','purchases','stock_movements',
    'safari_usage','ticket_usage','guest_experiences','accounts_status','simple_stock',
    'monthly_reports'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- 13b. Standard lodge-scoped policy for all lodge_id tables (read/write if you have access)
do $$
declare t text;
begin
  foreach t in array array[
    'attachments','notifications','notification_rules','occupancy_daily','extra_sales',
    'ratings','travel_agents','expenses','energy_readings','vehicles','vehicle_logs',
    'assets','service_records','staff','staff_attendance','staff_advances','payroll',
    'bar_items','bar_rate_history','bar_stock_movements','stock_items','purchases',
    'stock_movements','safari_usage','ticket_usage','guest_experiences','accounts_status',
    'simple_stock','monthly_reports'
  ] loop
    execute format($f$
      create policy %1$s_access on public.%1$I
        for all to authenticated
        using (lodge_id is null or public.has_lodge_access(lodge_id))
        with check (lodge_id is null or public.has_lodge_access(lodge_id));
    $f$, t);
  end loop;
end $$;

-- 13c. profiles: users see themselves; admins see all; only admins edit others;
--      only super_admin may create/modify super_admin rows.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = public.my_role());

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (
    public.is_admin()
    and (role <> 'super_admin' or public.is_super_admin())  -- only super_admin manages super_admins
  );

-- 13d. lodges: admins see all; managers see assigned; admins write; only super_admin deletes
create policy lodges_select on public.lodges
  for select to authenticated
  using (public.is_admin()
         or exists (select 1 from public.user_lodge_access
                    where user_id = auth.uid() and lodge_id = id));

create policy lodges_admin_insert on public.lodges
  for insert to authenticated with check (public.is_admin());

create policy lodges_admin_update on public.lodges
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy lodges_superadmin_delete on public.lodges
  for delete to authenticated using (public.is_super_admin());

-- 13e. user_lodge_access: admins manage; users can read their own rows
create policy ula_select on public.user_lodge_access
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy ula_admin_write on public.user_lodge_access
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 13f. audit_log: admins read; inserts happen via definer functions/server
create policy audit_admin_read on public.audit_log
  for select to authenticated using (public.is_admin());

-- =============================================================================
-- 14. Handy analytics views (extend freely)
-- =============================================================================

-- Monthly occupancy roll-up per lodge
create or replace view public.v_monthly_occupancy as
select lodge_id,
       date_trunc('month', entry_date)::date as month,
       sum(rooms_paid)  as rooms_paid,
       sum(rooms_comp)  as rooms_comp,
       sum(rooms_paid + rooms_comp) as room_nights,
       sum(total_pax)   as total_pax
from public.occupancy_daily
group by 1,2;

-- Monthly expense roll-up per lodge & category
create or replace view public.v_monthly_expenses as
select lodge_id,
       date_trunc('month', entry_date)::date as month,
       category,
       sum(amount) as total_amount
from public.expenses
group by 1,2,3;

-- Services due / overdue (feeds the notification job)
create or replace view public.v_service_due as
select s.lodge_id, a.name as asset, a.criticality, s.service_date, s.next_due,
       (s.next_due - current_date) as days_to_due
from public.service_records s
join public.assets a on a.id = s.asset_id
where s.next_due is not null
  and s.id in (  -- latest service per asset
    select distinct on (asset_id) id from public.service_records
    order by asset_id, service_date desc
  );

-- =============================================================================
-- DONE. Next: create a Storage bucket named 'attachments' (private) in Supabase,
-- then follow BUILD_GUIDE.md to scaffold the Next.js app with Claude Code.
-- =============================================================================

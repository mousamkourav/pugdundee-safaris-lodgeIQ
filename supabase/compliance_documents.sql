-- ============================================================================
-- Insurances & Licences (compliance_documents)
-- Per-lodge documents with an expiry date that drives 30-day expiry alerts.
-- Run this in the Supabase SQL editor once.
-- ============================================================================

create table if not exists public.compliance_documents (
  id            uuid primary key default gen_random_uuid(),
  lodge_id      uuid not null references public.lodges (id) on delete cascade,
  doc_type      text not null default 'insurance'
                  check (doc_type in ('insurance', 'licence')),
  title         text not null,
  authority     text,               -- insurer / issuing authority (optional)
  reference_no  text,               -- policy or licence number (optional)
  issue_date    date,               -- optional
  expiry_date   date not null,      -- drives the alerts
  notes         text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists compliance_documents_lodge_idx
  on public.compliance_documents (lodge_id);
create index if not exists compliance_documents_expiry_idx
  on public.compliance_documents (expiry_date);

-- keep updated_at fresh
create or replace function public.touch_compliance_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_compliance_touch on public.compliance_documents;
create trigger trg_compliance_touch
  before update on public.compliance_documents
  for each row execute function public.touch_compliance_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — mirrors how monthly_submissions / assets are scoped:
-- a user may see & manage documents for lodges they can access. Adjust the
-- helper name below if your project already has one (e.g. can_access_lodge()).
-- ---------------------------------------------------------------------------
alter table public.compliance_documents enable row level security;

-- Helper: is the current user allowed to touch this lodge?
-- Uses the same membership/role idea as your other tables. If you already have
-- a function like public.can_access_lodge(uuid), replace the USING/CHECK bodies
-- below with:  public.can_access_lodge(lodge_id)
create or replace function public.user_can_access_lodge(p_lodge uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid()
        and pr.role in ('admin', 'super_admin')
    )
    or exists (
      -- managers/members linked to the lodge; adjust table/columns if different
      select 1 from public.lodge_members lm
      where lm.lodge_id = p_lodge
        and lm.user_id = auth.uid()
    )
    or exists (
      -- fallback: profiles carrying a single lodge_id
      select 1 from public.profiles pr
      where pr.id = auth.uid()
        and pr.lodge_id = p_lodge
    );
$$;

drop policy if exists compliance_select on public.compliance_documents;
create policy compliance_select on public.compliance_documents
  for select using (public.user_can_access_lodge(lodge_id));

drop policy if exists compliance_insert on public.compliance_documents;
create policy compliance_insert on public.compliance_documents
  for insert with check (public.user_can_access_lodge(lodge_id));

drop policy if exists compliance_update on public.compliance_documents;
create policy compliance_update on public.compliance_documents
  for update using (public.user_can_access_lodge(lodge_id))
  with check (public.user_can_access_lodge(lodge_id));

drop policy if exists compliance_delete on public.compliance_documents;
create policy compliance_delete on public.compliance_documents
  for delete using (public.user_can_access_lodge(lodge_id));

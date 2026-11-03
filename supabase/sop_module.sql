-- =============================================================================
-- SOP module (the third tab, "SOP"): tables, access rules, functions, storage.
--
-- What it does (only NEW things; nothing that exists is changed):
--   * tables  sop_documents (one SOP now, ready for more), sop_sections (the DRAFT the super
--     admin edits), sop_versions + sop_version_sections (each published version, frozen),
--     sop_access (who may read: a person or a whole role), sop_reads ("I have read version N"),
--     sop_audit (imports, publishes, restores, access changes);
--   * row level security on every one of them: the super admin does everything; others read
--     the PUBLISHED versions only, and only when given access (by person or by role); a person
--     can only record their own "I have read";
--   * functions the app calls: sop_is_editor, sop_can_view, sop_my_status, sop_replace_draft
--     (import / restore), sop_publish, sop_set_order, sop_grant, sop_revoke. Each changing one
--     checks for the super admin and writes the audit line in the same transaction;
--   * the PRIVATE storage bucket "sop-media" (pictures, the original Word file). The app reads
--     it on the server after checking access; nobody gets a public link.
--
-- Safe to run more than once. Run it whole in the Supabase SQL Editor.
-- Expected result (the check at the end): see the last statement.
-- =============================================================================

do $sop$
begin
  -- ------------------------------------------------------------------ tables
  create table if not exists public.sop_documents (
    id               uuid primary key default gen_random_uuid(),
    title            text not null default 'Standard Operating Procedures',
    original_path    text,
    original_name    text,
    original_size    bigint,
    draft_updated_at timestamptz,
    draft_updated_by uuid references public.profiles(id) on delete set null,
    created_at       timestamptz not null default now()
  );

  create table if not exists public.sop_sections (
    id          uuid primary key default gen_random_uuid(),
    document_id uuid not null references public.sop_documents(id) on delete cascade,
    position    int  not null,
    title       text not null check (char_length(title) between 1 and 200),
    body_json   jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}',
    body_html   text not null default '',
    body_text   text not null default '',
    updated_at  timestamptz not null default now(),
    updated_by  uuid references public.profiles(id) on delete set null
  );
  create index if not exists sop_sections_doc_pos on public.sop_sections(document_id, position);

  create table if not exists public.sop_versions (
    id            uuid primary key default gen_random_uuid(),
    document_id   uuid not null references public.sop_documents(id) on delete cascade,
    number        int  not null,
    note          text not null check (char_length(note) between 1 and 500),
    published_by  uuid references public.profiles(id) on delete set null,
    published_at  timestamptz not null default now(),
    unique (document_id, number)
  );

  create table if not exists public.sop_version_sections (
    version_id uuid not null references public.sop_versions(id) on delete cascade,
    section_id uuid not null,
    position   int  not null,
    title      text not null,
    body_json  jsonb not null,
    body_text  text not null default '',
    primary key (version_id, section_id)
  );
  create index if not exists sop_version_sections_pos on public.sop_version_sections(version_id, position);

  create table if not exists public.sop_access (
    id          uuid primary key default gen_random_uuid(),
    document_id uuid not null references public.sop_documents(id) on delete cascade,
    user_id     uuid references public.profiles(id) on delete cascade,
    role        text,
    granted_by  uuid references public.profiles(id) on delete set null,
    granted_at  timestamptz not null default now(),
    constraint sop_access_one check ((user_id is null) <> (role is null))
  );
  create unique index if not exists sop_access_user_uq on public.sop_access(document_id, user_id) where user_id is not null;
  create unique index if not exists sop_access_role_uq on public.sop_access(document_id, role) where role is not null;

  create table if not exists public.sop_reads (
    version_id uuid not null references public.sop_versions(id) on delete cascade,
    user_id    uuid not null references public.profiles(id) on delete cascade,
    read_at    timestamptz not null default now(),
    primary key (version_id, user_id)
  );

  create table if not exists public.sop_audit (
    id          bigint generated always as identity primary key,
    document_id uuid references public.sop_documents(id) on delete set null,
    action      text not null check (action in ('import','publish','restore','access_grant','access_revoke')),
    detail      jsonb not null default '{}',
    actor       uuid references public.profiles(id) on delete set null,
    at          timestamptz not null default now()
  );
  create index if not exists sop_audit_at on public.sop_audit(at desc);

  -- the one SOP document
  insert into public.sop_documents (title)
  select 'Standard Operating Procedures'
  where not exists (select 1 from public.sop_documents);

  -- ------------------------------------------------------------------ functions
  -- the super admin, active
  create or replace function public.sop_is_editor()
  returns boolean language sql stable security definer set search_path = public as $f$
    select coalesce((select p.role = 'super_admin' and p.status = 'active' from public.profiles p where p.id = auth.uid()), false);
  $f$;

  -- may the signed-in user read this SOP? (super admin, or access by person or by role)
  create or replace function public.sop_can_view(p_doc uuid)
  returns boolean language sql stable security definer set search_path = public as $f$
    select public.sop_is_editor() or exists (
      select 1
      from public.profiles p
      join public.sop_access a on a.document_id = p_doc and (a.user_id = p.id or a.role = p.role)
      where p.id = auth.uid() and p.status = 'active'
    );
  $f$;

  -- what every page needs, in one call: access, the current version, read or not
  create or replace function public.sop_my_status()
  returns jsonb language plpgsql stable security definer set search_path = public as $f$
  declare
    d uuid;
    v record;
    ok boolean;
  begin
    select id into d from public.sop_documents order by created_at limit 1;
    ok := d is not null and public.sop_can_view(d);
    if not ok then
      return jsonb_build_object('can_view', false, 'is_editor', false);
    end if;
    select id, number into v from public.sop_versions where document_id = d order by number desc limit 1;
    return jsonb_build_object(
      'can_view', true,
      'is_editor', public.sop_is_editor(),
      'document_id', d,
      'version', v.number,
      'version_id', v.id,
      'read', v.id is not null and exists (select 1 from public.sop_reads r where r.version_id = v.id and r.user_id = auth.uid())
    );
  end
  $f$;

  -- replace the whole draft (import from Word, restore an old version), with the audit line
  create or replace function public.sop_replace_draft(p_doc uuid, p_sections jsonb, p_action text, p_detail jsonb)
  returns int language plpgsql security definer set search_path = public as $f$
  declare n int;
  begin
    if not public.sop_is_editor() then raise exception 'Only the super admin can change the SOP.'; end if;
    if p_action not in ('import', 'restore') then raise exception 'Unknown action %', p_action; end if;
    if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) = 0 then raise exception 'No sections.'; end if;
    perform 1 from public.sop_documents where id = p_doc for update;
    if not found then raise exception 'No such SOP.'; end if;
    delete from public.sop_sections where document_id = p_doc;
    insert into public.sop_sections (id, document_id, position, title, body_json, body_html, body_text, updated_by)
    select coalesce(nullif(s->>'id', '')::uuid, gen_random_uuid()), p_doc, (o - 1)::int, left(s->>'title', 200),
           s->'body_json', coalesce(s->>'body_html', ''), coalesce(s->>'body_text', ''), auth.uid()
    from jsonb_array_elements(p_sections) with ordinality as t(s, o);
    get diagnostics n = row_count;
    update public.sop_documents set draft_updated_at = now(), draft_updated_by = auth.uid() where id = p_doc;
    insert into public.sop_audit (document_id, action, detail, actor)
    values (p_doc, p_action, coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('sections', n), auth.uid());
    return n;
  end
  $f$;

  -- publish the draft as the next version (a frozen copy of every section)
  create or replace function public.sop_publish(p_doc uuid, p_note text)
  returns int language plpgsql security definer set search_path = public as $f$
  declare n int; vid uuid; c int;
  begin
    if not public.sop_is_editor() then raise exception 'Only the super admin can publish the SOP.'; end if;
    if coalesce(btrim(p_note), '') = '' then raise exception 'Write what changed.'; end if;
    perform 1 from public.sop_documents where id = p_doc for update;
    if not found then raise exception 'No such SOP.'; end if;
    select count(*) into c from public.sop_sections where document_id = p_doc;
    if c = 0 then raise exception 'The draft is empty.'; end if;
    select coalesce(max(number), 0) + 1 into n from public.sop_versions where document_id = p_doc;
    insert into public.sop_versions (document_id, number, note, published_by)
    values (p_doc, n, left(btrim(p_note), 500), auth.uid()) returning id into vid;
    insert into public.sop_version_sections (version_id, section_id, position, title, body_json, body_text)
    select vid, s.id, s.position, s.title, s.body_json, s.body_text from public.sop_sections s where s.document_id = p_doc;
    insert into public.sop_audit (document_id, action, detail, actor)
    values (p_doc, 'publish', jsonb_build_object('version', n, 'note', left(btrim(p_note), 500), 'sections', c), auth.uid());
    return n;
  end
  $f$;

  -- the order of the draft's sections
  create or replace function public.sop_set_order(p_doc uuid, p_ids uuid[])
  returns void language plpgsql security definer set search_path = public as $f$
  begin
    if not public.sop_is_editor() then raise exception 'Only the super admin can change the SOP.'; end if;
    update public.sop_sections s set position = (u.o - 1)::int
    from unnest(p_ids) with ordinality as u(id, o)
    where s.id = u.id and s.document_id = p_doc;
    update public.sop_documents set draft_updated_at = now(), draft_updated_by = auth.uid() where id = p_doc;
  end
  $f$;

  -- give access to a person or a role (one of the two), with the audit line
  create or replace function public.sop_grant(p_doc uuid, p_user uuid, p_role text)
  returns void language plpgsql security definer set search_path = public as $f$
  begin
    if not public.sop_is_editor() then raise exception 'Only the super admin can change access.'; end if;
    if (p_user is null) = (p_role is null) then raise exception 'Choose a person or a role.'; end if;
    if p_user is not null then
      insert into public.sop_access (document_id, user_id, granted_by) values (p_doc, p_user, auth.uid())
      on conflict (document_id, user_id) where user_id is not null do nothing;
    else
      insert into public.sop_access (document_id, role, granted_by) values (p_doc, p_role, auth.uid())
      on conflict (document_id, role) where role is not null do nothing;
    end if;
    if found then
      insert into public.sop_audit (document_id, action, detail, actor)
      values (p_doc, 'access_grant', jsonb_strip_nulls(jsonb_build_object('user_id', p_user, 'role', p_role)), auth.uid());
    end if;
  end
  $f$;

  create or replace function public.sop_revoke(p_access uuid)
  returns void language plpgsql security definer set search_path = public as $f$
  declare a record;
  begin
    if not public.sop_is_editor() then raise exception 'Only the super admin can change access.'; end if;
    delete from public.sop_access where id = p_access returning document_id, user_id, role into a;
    if a.document_id is not null then
      insert into public.sop_audit (document_id, action, detail, actor)
      values (a.document_id, 'access_revoke', jsonb_strip_nulls(jsonb_build_object('user_id', a.user_id, 'role', a.role)), auth.uid());
    end if;
  end
  $f$;

  -- ------------------------------------------------------------------ row level security
  alter table public.sop_documents        enable row level security;
  alter table public.sop_sections         enable row level security;
  alter table public.sop_versions         enable row level security;
  alter table public.sop_version_sections enable row level security;
  alter table public.sop_access           enable row level security;
  alter table public.sop_reads            enable row level security;
  alter table public.sop_audit            enable row level security;

  drop policy if exists sop_documents_read on public.sop_documents;
  create policy sop_documents_read on public.sop_documents for select using (public.sop_can_view(id));
  drop policy if exists sop_documents_edit on public.sop_documents;
  create policy sop_documents_edit on public.sop_documents for update using (public.sop_is_editor()) with check (public.sop_is_editor());

  -- the draft: the super admin only
  drop policy if exists sop_sections_editor on public.sop_sections;
  create policy sop_sections_editor on public.sop_sections for all using (public.sop_is_editor()) with check (public.sop_is_editor());

  -- published versions: whoever may read the SOP (written only by sop_publish)
  drop policy if exists sop_versions_read on public.sop_versions;
  create policy sop_versions_read on public.sop_versions for select using (public.sop_can_view(document_id));
  drop policy if exists sop_version_sections_read on public.sop_version_sections;
  create policy sop_version_sections_read on public.sop_version_sections for select
    using (exists (select 1 from public.sop_versions v where v.id = version_id and public.sop_can_view(v.document_id)));

  -- access list: the super admin reads it (changes go through sop_grant / sop_revoke)
  drop policy if exists sop_access_read on public.sop_access;
  create policy sop_access_read on public.sop_access for select using (public.sop_is_editor());

  -- "I have read": your own, for a version you may read; the super admin sees everyone's
  drop policy if exists sop_reads_read on public.sop_reads;
  create policy sop_reads_read on public.sop_reads for select using (user_id = auth.uid() or public.sop_is_editor());
  drop policy if exists sop_reads_insert on public.sop_reads;
  create policy sop_reads_insert on public.sop_reads for insert
    with check (user_id = auth.uid() and exists (select 1 from public.sop_versions v where v.id = version_id and public.sop_can_view(v.document_id)));

  drop policy if exists sop_audit_read on public.sop_audit;
  create policy sop_audit_read on public.sop_audit for select using (public.sop_is_editor());

  -- ------------------------------------------------------------------ storage (private)
  insert into storage.buckets (id, name, public, allowed_mime_types)
  values ('sop-media', 'sop-media', false,
          array['image/png','image/jpeg','image/gif','image/webp','application/json',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
  on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;
end
$sop$;

-- ---------------------------------------------------------------------- check
-- Expected: tables 7 | rls on 7 | functions 8 | documents 1 | bucket sop-media private
select 'tables' as what, count(*)::text as result
  from information_schema.tables where table_schema = 'public' and table_name like 'sop\_%'
union all
select 'rls on', count(*)::text
  from pg_tables where schemaname = 'public' and tablename like 'sop\_%' and rowsecurity
union all
select 'functions', count(*)::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('sop_is_editor','sop_can_view','sop_my_status','sop_replace_draft','sop_publish','sop_set_order','sop_grant','sop_revoke')
union all
select 'documents', count(*)::text from public.sop_documents
union all
select 'bucket sop-media', coalesce((select case when public then 'PUBLIC (wrong)' else 'private' end from storage.buckets where id = 'sop-media'), 'missing');

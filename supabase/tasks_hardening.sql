-- =============================================================================
-- Trip reports / tasks: security hardening
-- Run once in the Supabase SQL editor. Safe to re-run (create or replace /
-- drop if exists).
--
-- Why: the tasks UPDATE policy is has_lodge_access(lodge_id), which is needed
-- so managers can submit completion. But RLS cannot limit WHICH columns or
-- values an update writes, so without this a manager could call the REST API
-- directly and set status = 'resolved', or rewrite created_by / resolved_by.
-- The trigger below enforces the same rules the app's server actions use.
--
-- Role names used here are the CURRENT ones (see lib/auth.ts):
--   task admins  = super_admin, senior_manager   (assign / edit / delete)
--   file admins  = super_admin, senior_manager, delhi_accounts
-- They are checked via public.my_role() so this file does not depend on how
-- is_admin() / is_super_admin() are currently defined in the database.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- (a) tasks: column / transition guard
-- -----------------------------------------------------------------------------

create or replace function public.tasks_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  is_task_admin boolean := coalesce(public.my_role() in ('super_admin','senior_manager'), false);
  -- The one legitimate "reviewer" transition: creator moves submitted -> resolved/declined.
  is_review boolean :=
        new.status in ('resolved','declined')
    and new.status is distinct from old.status;
  -- The one legitimate "manager" transition: pending/declined -> submitted.
  is_submit boolean :=
        old.status in ('pending','declined')
    and new.status = 'submitted';
begin
  -- No end-user JWT (service role, SQL editor, cron): trusted, skip checks.
  if uid is null then
    return new;
  end if;

  -- 1. Identity columns never change, for anyone. created_by is what decides
  --    who may review, so it must not be rewritable.
  if new.id is distinct from old.id
     or new.lodge_id is distinct from old.lodge_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'tasks: id, lodge_id, created_by and created_at are read-only'
      using errcode = '42501';
  end if;

  -- 2. Only the task's creator may resolve or decline it, only from
  --    'submitted', and resolved_by must be the creator themself.
  if is_review then
    if uid is distinct from old.created_by then
      raise exception 'tasks: only the person who assigned this task can approve or decline it'
        using errcode = '42501';
    end if;
    if old.status <> 'submitted' then
      raise exception 'tasks: only a submitted task can be approved or declined'
        using errcode = '42501';
    end if;
    if new.resolved_by is distinct from uid then
      raise exception 'tasks: resolved_by must be the reviewing user'
        using errcode = '42501';
    end if;
  end if;

  -- 3. Review columns (resolved_by, resolved_at, decline_reason) may only
  --    change as part of that creator review in step 2.
  if (new.resolved_by   is distinct from old.resolved_by
      or new.resolved_at    is distinct from old.resolved_at
      or new.decline_reason is distinct from old.decline_reason)
     and not is_review then
    raise exception 'tasks: review fields can only be set when approving or declining'
      using errcode = '42501';
  end if;

  -- 4. Everyone who is not a task admin (lodge managers, delhi_accounts, ...)
  --    may ONLY submit completion: pending/declined -> submitted, writing the
  --    completion fields, with submitted_by = themselves.
  if not is_task_admin then
    if new.title           is distinct from old.title
       or new.description     is distinct from old.description
       or new.priority        is distinct from old.priority
       or new.due_date        is distinct from old.due_date
       or new.assigned_photos is distinct from old.assigned_photos then
      raise exception 'tasks: only senior managers can edit task details'
        using errcode = '42501';
    end if;

    if new.status is distinct from old.status and not is_submit and not is_review then
      raise exception 'tasks: status change not allowed'
        using errcode = '42501';
    end if;

    if (new.completion_photos     is distinct from old.completion_photos
        or new.completion_comment is distinct from old.completion_comment
        or new.submitted_by       is distinct from old.submitted_by
        or new.submitted_at       is distinct from old.submitted_at)
       and not is_submit then
      raise exception 'tasks: completion can only be changed when submitting'
        using errcode = '42501';
    end if;

    if is_submit and new.submitted_by is distinct from uid then
      raise exception 'tasks: submitted_by must be the submitting user'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

-- BEFORE UPDATE so a rejected change is aborted before it is written.
drop trigger if exists tasks_guard_update on public.tasks;
create trigger tasks_guard_update
  before update on public.tasks
  for each row execute function public.tasks_guard_update();


-- -----------------------------------------------------------------------------
-- (b) storage: only the uploader or an admin may delete task photos
-- -----------------------------------------------------------------------------
-- The app's server actions delete other people's files (old completion photos
-- on resubmit, whole folder on task delete) with the service role, which
-- bypasses these policies. So this only restricts direct/browser deletes: the
-- browser only ever deletes files it just uploaded (cleanup after a failed
-- save), which it owns.

-- Drop the existing DELETE policy (or policies) for the task-photos bucket,
-- whatever it was named when created in the dashboard. Only DELETE policies
-- that mention 'task-photos' are touched.
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and cmd        = 'DELETE'
      and coalesce(qual, '') like '%task-photos%'
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

-- New DELETE policy: in the task-photos bucket, a signed-in user may delete a
-- file only if they uploaded it (owner_id is set by Storage to the uploader's
-- auth uid) or they are an admin role.
drop policy if exists "task-photos delete own or admin" on storage.objects;
create policy "task-photos delete own or admin"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'task-photos'
    and (
      owner_id = (select auth.uid())::text
      or public.my_role() in ('super_admin','senior_manager','delhi_accounts')
    )
  );

-- Optional, recommended: apply the same rule to UPDATE (overwriting a file in
-- place). The app never overwrites (uploads use upsert: false), so this does
-- not affect it. Uncomment to enable; it drops any existing UPDATE policy that
-- mentions task-photos first.
--
-- do $$
-- declare p record;
-- begin
--   for p in select policyname from pg_policies
--            where schemaname = 'storage' and tablename = 'objects'
--              and cmd = 'UPDATE' and coalesce(qual, '') || coalesce(with_check, '') like '%task-photos%'
--   loop
--     execute format('drop policy %I on storage.objects', p.policyname);
--   end loop;
-- end $$;
-- create policy "task-photos update own or admin"
--   on storage.objects for update to authenticated
--   using (bucket_id = 'task-photos'
--          and (owner_id = (select auth.uid())::text
--               or public.my_role() in ('super_admin','senior_manager','delhi_accounts')))
--   with check (bucket_id = 'task-photos');


-- -----------------------------------------------------------------------------
-- Check what is in place afterwards:
-- select policyname, cmd, qual from pg_policies
--  where schemaname = 'storage' and tablename = 'objects';
-- select tgname from pg_trigger where tgrelid = 'public.tasks'::regclass;
-- -----------------------------------------------------------------------------

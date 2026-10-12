-- =============================================================================
-- Creator-only edits: tasks and monthly reports
-- Run in the Supabase SQL editor AFTER supabase/tasks_department_and_edit.sql
-- (it replaces that file's tasks_guard_update function). Safe to re-run.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- (A) tasks_guard_update: ONLY the task's creator may edit detail fields.
-- Identical to tasks_department_and_edit.sql except step 4, which no longer
-- lets super_admin / senior_manager edit details. Review, submit and identity
-- rules are unchanged; task admins still keep their status powers (step 5).
-- -----------------------------------------------------------------------------
create or replace function public.tasks_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  is_task_admin boolean := coalesce(public.my_role() in ('super_admin','senior_manager'), false);
  is_creator boolean := uid is not null and uid = old.created_by;
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
  --    who may review and edit, so it must not be rewritable.
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

  -- 4. Detail fields: the task's creator ONLY (no admin override).
  if (new.title           is distinct from old.title
      or new.description     is distinct from old.description
      or new.priority        is distinct from old.priority
      or new.due_date        is distinct from old.due_date
      or new.department      is distinct from old.department
      or new.assigned_photos is distinct from old.assigned_photos)
     and not is_creator then
    raise exception 'tasks: only the person who assigned this task can edit its details'
      using errcode = '42501';
  end if;

  -- 5. Everyone who is not a task admin (lodge managers, delhi_accounts, ...)
  --    may otherwise ONLY submit completion: pending/declined -> submitted,
  --    writing the completion fields, with submitted_by = themselves.
  if not is_task_admin then
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

drop trigger if exists tasks_guard_update on public.tasks;
create trigger tasks_guard_update
  before update on public.tasks
  for each row execute function public.tasks_guard_update();


-- -----------------------------------------------------------------------------
-- (B) monthly_submissions: only the report's creator may change its data.
-- Mirrors canEditReportData in lib/monthly.ts. The app already enforces this in
-- monthly/actions.ts; this stops anyone bypassing it through the REST API.
--
--   owner = created_by, else submitted_by (older rows).
--   Rows with neither (historical imports) are "unowned": a non-admin user
--   (RLS limits them to their lodge) may edit them, and the first save fills
--   created_by with that user.
--   Admin overrides are untouched: reopen / approve / decline only change
--   status, submitted_by and submitted_at, never data. Delete is not an update.
-- -----------------------------------------------------------------------------
create or replace function public.monthly_submissions_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  owner uuid := coalesce(old.created_by, old.submitted_by);
  is_admin_role boolean :=
    coalesce(public.my_role() in ('super_admin','senior_manager','delhi_accounts'), false);
begin
  -- No end-user JWT (service role, SQL editor, cron): trusted, skip checks.
  if uid is null then
    return new;
  end if;

  -- created_by can only be filled in once: by the saving user, or (on reopen)
  -- copied from submitted_by so ownership survives submitted_by being cleared.
  if new.created_by is distinct from old.created_by then
    if old.created_by is not null
       or new.created_by is null
       or (new.created_by is distinct from uid
           and new.created_by is distinct from old.submitted_by) then
      raise exception 'monthly_submissions: created_by cannot be changed'
        using errcode = '42501';
    end if;
  end if;

  if new.data is distinct from old.data then
    if owner is not null and uid is distinct from owner then
      raise exception 'monthly_submissions: only the person who created this report can edit it'
        using errcode = '42501';
    end if;
    if owner is null and is_admin_role then
      raise exception 'monthly_submissions: only the lodge manager can edit this report'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists monthly_submissions_guard_update on public.monthly_submissions;
create trigger monthly_submissions_guard_update
  before update on public.monthly_submissions
  for each row execute function public.monthly_submissions_guard_update();


-- -----------------------------------------------------------------------------
-- Check afterwards:
-- select tgname, tgrelid::regclass from pg_trigger
--  where tgname in ('tasks_guard_update','monthly_submissions_guard_update');
-- -----------------------------------------------------------------------------

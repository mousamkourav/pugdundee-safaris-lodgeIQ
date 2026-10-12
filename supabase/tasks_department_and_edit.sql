-- =============================================================================
-- Trip reports: task department, creator edits, 200KB photo ceiling
-- Run once in the Supabase SQL editor BEFORE deploying the matching app code
-- (the app now writes tasks.department). Safe to re-run.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- (1) tasks.department
-- Keys must match TASK_DEPARTMENTS in lib/tasks.ts. Nullable: the tasks that
-- existed before this column have no department until someone edits them.
-- -----------------------------------------------------------------------------
alter table public.tasks
  add column if not exists department text;

alter table public.tasks
  drop constraint if exists tasks_department_check;
alter table public.tasks
  add constraint tasks_department_check
  check (
    department is null
    or department in (
      'housekeeping', 'fnb', 'maintenance', 'naturalist', 'front_office',
      'kitchen', 'security', 'gardens', 'transport', 'other'
    )
  );

create index if not exists tasks_department_idx on public.tasks (department);


-- -----------------------------------------------------------------------------
-- (2) Data API grants (Oct-2026 Supabase change: grants are no longer implied,
-- so state them explicitly). RLS still decides which rows each user can touch.
-- anon gets nothing.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update, delete on table public.trips to authenticated;
grant all on table public.tasks to service_role;
grant all on table public.trips to service_role;
revoke all on table public.tasks from anon;
revoke all on table public.trips from anon;


-- -----------------------------------------------------------------------------
-- (3) tasks_guard_update: the task's creator may now edit detail fields
-- (title, description, priority, due_date, department, assigned_photos) as
-- well as super_admin / senior_manager. Everything else is unchanged from
-- supabase/tasks_hardening.sql.
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

  -- 4. Detail fields: task admins or the task's creator only.
  if (new.title           is distinct from old.title
      or new.description     is distinct from old.description
      or new.priority        is distinct from old.priority
      or new.due_date        is distinct from old.due_date
      or new.department      is distinct from old.department
      or new.assigned_photos is distinct from old.assigned_photos)
     and not is_task_admin and not is_creator then
    raise exception 'tasks: only the person who assigned this task or a senior manager can edit its details'
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
-- (4) Server-side 200KB ceiling for task photos. The browser already
-- compresses every reference and completion photo under 200KB; this makes
-- Storage reject anything larger even if a client skips compression.
-- Only the task-photos bucket (Sales uses sales-media, unaffected).
-- -----------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 204800,
       allowed_mime_types = array['image/jpeg']
 where id = 'task-photos';


-- -----------------------------------------------------------------------------
-- Check afterwards:
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'tasks' and column_name = 'department';
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name in ('tasks','trips') order by 1, 2;
-- select id, file_size_limit, allowed_mime_types from storage.buckets where id = 'task-photos';
-- -----------------------------------------------------------------------------

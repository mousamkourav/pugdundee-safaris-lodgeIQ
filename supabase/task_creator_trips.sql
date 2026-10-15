-- =============================================================================
-- task_creator (Harshita): trips, task review and photo upload
-- Run in the Supabase SQL editor AFTER the task_creator role migration (which
-- added the role, public.is_task_creator() and the tasks insert/select
-- policies). Safe to re-run.
--
-- Why: the app now lets task_creator call createTrip / addTasksToTrip, but she
-- has no user_lodge_access rows, so every policy built on has_lodge_access()
-- rejects her. These policies are ADDITIVE (permissive policies are OR'd), so
-- nothing changes for existing roles.
--
-- Check first what already exists (skip a section if it is already covered):
--   select tablename, policyname, cmd, qual, with_check from pg_policies
--    where (schemaname = 'public' and tablename in ('trips','tasks'))
--       or (schemaname = 'storage' and tablename = 'objects');
-- =============================================================================


-- (1) trips: insert for any lodge as herself; read / delete only her own.
--     Delete is needed because createTrip removes the trip header again if the
--     task insert fails.
drop policy if exists "trips task_creator insert" on public.trips;
create policy "trips task_creator insert"
  on public.trips for insert to authenticated
  with check ((select public.is_task_creator()) and created_by = (select auth.uid()));

drop policy if exists "trips task_creator select own" on public.trips;
create policy "trips task_creator select own"
  on public.trips for select to authenticated
  using ((select public.is_task_creator()) and created_by = (select auth.uid()));

drop policy if exists "trips task_creator delete own" on public.trips;
create policy "trips task_creator delete own"
  on public.trips for delete to authenticated
  using ((select public.is_task_creator()) and created_by = (select auth.uid()));


-- (2) tasks: update her own tasks (approve / decline / edit details). The
--     tasks_guard_update trigger still decides WHICH columns may change; a
--     creator can review and edit details but cannot submit-as-manager.
drop policy if exists "tasks task_creator update own" on public.tasks;
create policy "tasks task_creator update own"
  on public.tasks for update to authenticated
  using ((select public.is_task_creator()) and created_by = (select auth.uid()))
  with check ((select public.is_task_creator()) and created_by = (select auth.uid()));


-- (3) storage: upload reference photos into task-photos for any lodge folder.
--     (Existing insert policies check lodge access on the first path segment.)
drop policy if exists "task-photos insert task_creator" on storage.objects;
create policy "task-photos insert task_creator"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'task-photos' and (select public.is_task_creator()));


-- Data API grants (explicit grants required for new objects since Oct 2026).
-- trips / tasks already have these from tasks_department_and_edit.sql; repeated
-- here so this file is self-contained.
grant select, insert, update, delete on table public.trips to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant all on table public.trips to service_role;
grant all on table public.tasks to service_role;
revoke all on table public.trips from anon;
revoke all on table public.tasks from anon;
grant execute on function public.is_task_creator() to authenticated;

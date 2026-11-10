-- =====================================================================
-- Client links: /quote/jj-lheureux-x7k2m9/1, /quote/jj-lheureux-x7k2m9/2 (10 Nov 2026)
--   * sales_queries.share_key: the guest's first name words + 6 random letters and numbers
--     (no look-alikes: no l, 1, o, 0), made ONCE per quote and the same for every version
--     (the version is the number at the end). About 1 billion codes: it cannot be guessed.
--     Made for every existing quote now, and for every new quote by a trigger. A later change
--     of the guest's name does not change it (the links already sent keep working).
--   * sales_queries.share_disabled_at / _by: a quote's client links turned off (the query page's
--     "Turn the client link off"); every link of that quote then says it is no longer active,
--     the old /i/... links too. sales_link_audit: who turned it off or on, when.
--   * sales_link_misses: a wrong link opened (a hashed device, never the address itself, and the
--     time). Many wrong links from one device in 15 minutes = blocked for a while. Only the app
--     (service key) reads and writes it: row level security on, no policy.
--   Old links (/i/<slug> and /i/<32-character token>) keep working.
--
-- HOW IT RUNS: one DO block (all or nothing). Safe to run more than once.
-- EXPECTED RESULT (one row):
--   quotes_without_key | key_index | trigger | link_audit | link_misses
--   0                  | 1         | 1       | 1          | 1
-- =====================================================================

do $links$
declare
  qt text;
  r record;
  k text;
  tries int;
begin
  -- ---- columns on the quotes
  alter table public.sales_queries add column if not exists share_key text;
  alter table public.sales_queries add column if not exists share_disabled_at timestamptz;
  alter table public.sales_queries add column if not exists share_disabled_by uuid references auth.users(id) on delete set null;

  -- ---- the key: name words + 6 random characters (gen_random_uuid is cryptographically random)
  execute $f$
    create or replace function public.sales_share_key(guest text)
    returns text language plpgsql volatile set search_path = public as $b$
    declare
      alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
      words text;
      hex text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      code text := '';
      i int;
    begin
      words := lower(coalesce(guest, ''));
      words := translate(words, 'àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ', 'aaaaaaaceeeeiiiinoooooouuuuyy');
      words := regexp_replace(words, '[''`’]', '', 'g');
      words := regexp_replace(words, '\m(mr|mrs|ms|miss|dr|prof|untitled|draft)\M\.?', ' ', 'g');
      words := regexp_replace(words, '[^a-z0-9]+', '-', 'g');
      words := array_to_string((array_remove(string_to_array(words, '-'), ''))[1:2], '-');
      words := left(coalesce(nullif(words, ''), 'guest'), 24);
      words := regexp_replace(words, '-+$', '');
      for i in 0..5 loop
        code := code || substr(alphabet, (get_byte(decode(substr(hex, i * 2 + 1, 2), 'hex'), 0) % 32) + 1, 1);
      end loop;
      return words || '-' || code;
    end $b$
  $f$;

  -- ---- every existing quote gets its key (a new code on the rare clash)
  for r in select id, guest_name from public.sales_queries where share_key is null loop
    tries := 0;
    loop
      k := public.sales_share_key(r.guest_name);
      exit when not exists (select 1 from public.sales_queries where share_key = k);
      tries := tries + 1;
      if tries > 20 then raise exception 'could not make a unique link key'; end if;
    end loop;
    update public.sales_queries set share_key = k where id = r.id;
  end loop;

  create unique index if not exists sales_queries_share_key on public.sales_queries (share_key);

  -- ---- new quotes: the key is made when the quote is saved the first time
  execute $f$
    create or replace function public.sales_queries_share_key()
    returns trigger language plpgsql security definer set search_path = public as $b$
    declare
      k text;
      tries int := 0;
    begin
      if new.share_key is null then
        loop
          k := public.sales_share_key(new.guest_name);
          exit when not exists (select 1 from public.sales_queries where share_key = k);
          tries := tries + 1;
          if tries > 20 then raise exception 'could not make a unique link key'; end if;
        end loop;
        new.share_key := k;
      end if;
      return new;
    end $b$
  $f$;
  drop trigger if exists sales_queries_share_key on public.sales_queries;
  create trigger sales_queries_share_key before insert on public.sales_queries
    for each row execute function public.sales_queries_share_key();

  -- ---- who turned a client link off or on
  select format_type(a.atttypid, a.atttypmod) into qt from pg_attribute a where a.attrelid = 'public.sales_queries'::regclass and a.attname = 'id';
  execute format('create table if not exists public.sales_link_audit (
    id         uuid primary key default gen_random_uuid(),
    query_id   %1$s not null references public.sales_queries(id) on delete cascade,
    action     text not null check (action in (''off'', ''on'')),
    changed_by uuid references auth.users(id) on delete set null,
    changed_at timestamptz not null default now()
  )', qt);
  create index if not exists sales_link_audit_query on public.sales_link_audit (query_id, changed_at desc);
  alter table public.sales_link_audit enable row level security;
  drop policy if exists sales_link_audit_select on public.sales_link_audit;
  -- readable wherever the quote is readable (the quotes' own policies decide); written by the app
  create policy sales_link_audit_select on public.sales_link_audit
    for select to authenticated
    using (exists (select 1 from public.sales_queries q where q.id = query_id));

  -- ---- wrong links opened (hashed device + time only); the app alone reads and writes it
  create table if not exists public.sales_link_misses (
    id  bigserial primary key,
    who text not null check (length(who) between 16 and 64),
    at  timestamptz not null default now()
  );
  create index if not exists sales_link_misses_who on public.sales_link_misses (who, at desc);
  alter table public.sales_link_misses enable row level security;
  revoke all on public.sales_link_misses from anon, authenticated;
end
$links$;

select
  (select count(*) from public.sales_queries where share_key is null) as quotes_without_key,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'sales_queries_share_key') as key_index,
  (select count(*) from pg_trigger where tgname = 'sales_queries_share_key' and not tgisinternal) as trigger,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'sales_link_audit') as link_audit,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'sales_link_misses') as link_misses;

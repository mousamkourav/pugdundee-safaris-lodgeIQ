-- =====================================================================
-- Red Panda Outpost (Jaubari, Nepal; adjoining Singalila National Park): its own quotes, 5 Nov 2026.
--   * sales_queries.query_type: 'safari' (every quote so far, the default) or 'red_panda'. A Red Panda
--     quote is a Sales query like any other (same list, versions, status, payments), built and priced
--     by the Red Panda builder only.
--   * rp_tariff: the per-person package price (5 nights, airport to airport) by year, market (B2B =
--     agent, B2C foreign, B2C Indian) and the number of guests travelling together (1 - 10), from
--     Red_Panda_Tariff_Sheet.xlsx ("Selling 25-26", "Selling 26-27"). GST 5% extra.
--   * rp_supplements: single room supplement and tour leader (up to 3 paid guests; complimentary
--     from 4), per year and market, from the same sheet.
--   * rp_settings: the rules (GST 5%, 5-night package, 4 to 10 nights, up to 10 guests and 5 rooms,
--     minimum age 16, the two airports, payment terms) and the guest page text (itinerary, includes,
--     does not include, good to know, what to carry), from RedPanda.docx and Red_Panda_Outpost.pdf.
--   * rp_images: photos for the guest page (files in the public "sales-media" bucket, red-panda/...).
--   * rp_access: who may use Red Panda, by person or by role (like the SOP). The super admin always.
--   * rp_audit: every change of the tariff, supplements, settings, photos and access (a trigger).
-- Who: rp_can_use() = super admin, or access by person or role (active accounts); rp_is_editor() =
-- the super admin (changes Master data and access). Guests read nothing directly (the guest page
-- is served by the app).
-- Safe to run more than once: rates and text already there are not overwritten.
-- Run BEFORE pushing the Red Panda code (the Sales queries list reads query_type).
-- One DO block for the Supabase SQL Editor; the select at the end shows the result.
-- =====================================================================
do $rp$
begin
  -- ------------------------------------------------------------------ the quote type
  alter table public.sales_queries add column if not exists query_type text not null default 'safari';
  if not exists (select 1 from pg_constraint where conname = 'sales_queries_query_type_check') then
    alter table public.sales_queries add constraint sales_queries_query_type_check check (query_type in ('safari','red_panda'));
  end if;
  create index if not exists sales_queries_type on public.sales_queries (query_type, created_at desc);

  -- ------------------------------------------------------------------ tables
  create table if not exists public.rp_tariff (
    id          uuid primary key default gen_random_uuid(),
    season      text not null check (length(season) between 1 and 40),
    valid_from  date not null,
    valid_to    date not null,
    market      text not null check (market in ('b2b','foreign','indian')),
    guests      integer not null check (guests between 1 and 10),
    per_pax     numeric(12,2) not null check (per_pax >= 0 and per_pax <= 10000000),
    active      boolean not null default true,
    updated_at  timestamptz not null default now(),
    check (valid_to >= valid_from),
    unique (valid_from, market, guests)
  );
  create table if not exists public.rp_supplements (
    id          uuid primary key default gen_random_uuid(),
    season      text not null check (length(season) between 1 and 40),
    valid_from  date not null,
    valid_to    date not null,
    market      text not null check (market in ('b2b','foreign','indian')),
    kind        text not null check (kind in ('single_room','tour_leader')),
    amount      numeric(12,2) not null check (amount >= 0 and amount <= 10000000),
    active      boolean not null default true,
    updated_at  timestamptz not null default now(),
    check (valid_to >= valid_from),
    unique (valid_from, market, kind)
  );
  create table if not exists public.rp_settings (
    id          integer primary key default 1 check (id = 1),
    data        jsonb not null default '{}',
    updated_at  timestamptz not null default now()
  );
  create table if not exists public.rp_images (
    id           uuid primary key default gen_random_uuid(),
    storage_path text not null check (length(storage_path) <= 300),
    caption      text check (caption is null or length(caption) <= 200),
    is_cover     boolean not null default false,
    sort         integer not null default 0,
    created_at   timestamptz not null default now()
  );
  create table if not exists public.rp_access (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references public.profiles(id) on delete cascade,
    role        text,
    granted_by  uuid references public.profiles(id) on delete set null default auth.uid(),
    created_at  timestamptz not null default now(),
    check ((user_id is null) <> (role is null))
  );
  create unique index if not exists rp_access_user on public.rp_access (user_id) where user_id is not null;
  create unique index if not exists rp_access_role on public.rp_access (role) where role is not null;
  create table if not exists public.rp_audit (
    id          bigint generated always as identity primary key,
    table_name  text not null,
    row_id      text,
    action      text not null,
    old_row     jsonb,
    new_row     jsonb,
    actor       uuid default auth.uid(),
    at          timestamptz not null default now()
  );

  -- ------------------------------------------------------------------ functions
  create or replace function public.rp_is_editor()
  returns boolean language sql stable security definer set search_path = public as $f$
    select coalesce((select p.role = 'super_admin' and coalesce(p.status, 'active') = 'active' from public.profiles p where p.id = auth.uid()), false);
  $f$;

  create or replace function public.rp_can_use()
  returns boolean language sql stable security definer set search_path = public as $f$
    select public.rp_is_editor() or exists (
      select 1 from public.profiles p
      join public.rp_access a on (a.user_id = p.id or a.role = p.role)
      where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'
    );
  $f$;

  -- what the layout needs on every page, in one call
  create or replace function public.rp_my_access()
  returns jsonb language sql stable security definer set search_path = public as $f$
    select jsonb_build_object('can_use', public.rp_can_use(), 'is_editor', public.rp_is_editor());
  $f$;

  create or replace function public.rp_audit_row()
  returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    insert into public.rp_audit (table_name, row_id, action, old_row, new_row, actor)
    values (tg_table_name, coalesce(new.id, old.id)::text, lower(tg_op),
            case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
            case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
            auth.uid());
    return coalesce(new, old);
  end $f$;

  drop trigger if exists rp_tariff_audit on public.rp_tariff;
  create trigger rp_tariff_audit after insert or update or delete on public.rp_tariff for each row execute function public.rp_audit_row();
  drop trigger if exists rp_supplements_audit on public.rp_supplements;
  create trigger rp_supplements_audit after insert or update or delete on public.rp_supplements for each row execute function public.rp_audit_row();
  drop trigger if exists rp_settings_audit on public.rp_settings;
  create trigger rp_settings_audit after insert or update or delete on public.rp_settings for each row execute function public.rp_audit_row();
  drop trigger if exists rp_images_audit on public.rp_images;
  create trigger rp_images_audit after insert or update or delete on public.rp_images for each row execute function public.rp_audit_row();
  drop trigger if exists rp_access_audit on public.rp_access;
  create trigger rp_access_audit after insert or update or delete on public.rp_access for each row execute function public.rp_audit_row();

  -- ------------------------------------------------------------------ row level security
  alter table public.rp_tariff enable row level security;
  alter table public.rp_supplements enable row level security;
  alter table public.rp_settings enable row level security;
  alter table public.rp_images enable row level security;
  alter table public.rp_access enable row level security;
  alter table public.rp_audit enable row level security;

  drop policy if exists rp_tariff_read on public.rp_tariff;
  create policy rp_tariff_read on public.rp_tariff for select to authenticated using (public.rp_can_use());
  drop policy if exists rp_tariff_write on public.rp_tariff;
  create policy rp_tariff_write on public.rp_tariff for all to authenticated using (public.rp_is_editor()) with check (public.rp_is_editor());
  drop policy if exists rp_supplements_read on public.rp_supplements;
  create policy rp_supplements_read on public.rp_supplements for select to authenticated using (public.rp_can_use());
  drop policy if exists rp_supplements_write on public.rp_supplements;
  create policy rp_supplements_write on public.rp_supplements for all to authenticated using (public.rp_is_editor()) with check (public.rp_is_editor());
  drop policy if exists rp_settings_read on public.rp_settings;
  create policy rp_settings_read on public.rp_settings for select to authenticated using (public.rp_can_use());
  drop policy if exists rp_settings_write on public.rp_settings;
  create policy rp_settings_write on public.rp_settings for all to authenticated using (public.rp_is_editor()) with check (public.rp_is_editor());
  drop policy if exists rp_images_read on public.rp_images;
  create policy rp_images_read on public.rp_images for select to authenticated using (public.rp_can_use());
  drop policy if exists rp_images_write on public.rp_images;
  create policy rp_images_write on public.rp_images for all to authenticated using (public.rp_is_editor()) with check (public.rp_is_editor());
  drop policy if exists rp_access_editor on public.rp_access;
  create policy rp_access_editor on public.rp_access for all to authenticated using (public.rp_is_editor()) with check (public.rp_is_editor());
  drop policy if exists rp_audit_editor on public.rp_audit;
  create policy rp_audit_editor on public.rp_audit for select to authenticated using (public.rp_is_editor());

  -- ------------------------------------------------------------------ the tariff (per person, GST extra)
  insert into public.rp_tariff (season, valid_from, valid_to, market, guests, per_pax)
  select v.season, v.f, v.t, v.market, v.guests, v.per_pax
  from (
    select '2025-26' season, date '2025-10-01' f, date '2026-05-31' t, m.market, g.guests,
           case m.market when 'b2b' then g.b2b when 'foreign' then g.foreign_ when 'indian' then g.indian end per_pax
    from (values (1, 360000, 414000, 385000), (2, 200000, 230000, 214000), (3, 180000, 207000, 192500), (4, 165000, 190000, 176500),
                 (5, 160000, 184000, 171500), (6, 145000, 167000, 155500), (7, 155000, 178000, 166000), (8, 140000, 161000, 150000),
                 (9, 140000, 161000, 150000), (10, 140000, 161000, 150000)) as g(guests, b2b, foreign_, indian)
    cross join (values ('b2b'), ('foreign'), ('indian')) as m(market)
    union all
    select '2026-27', date '2026-10-01', date '2027-05-31', m.market, g.guests,
           case m.market when 'b2b' then g.b2b when 'foreign' then g.foreign_ when 'indian' then g.indian end
    from (values (1, 395000, 455000, 423000), (2, 220000, 253000, 235000), (3, 200000, 230000, 214000), (4, 182000, 210000, 195000),
                 (5, 176000, 203000, 188000), (6, 160000, 185000, 171000), (7, 170000, 195000, 182000), (8, 154000, 177000, 165000),
                 (9, 154000, 177000, 165000), (10, 154000, 177000, 165000)) as g(guests, b2b, foreign_, indian)
    cross join (values ('b2b'), ('foreign'), ('indian')) as m(market)
  ) v
  on conflict (valid_from, market, guests) do nothing;

  insert into public.rp_supplements (season, valid_from, valid_to, market, kind, amount)
  select v.* from (values
    ('2025-26', date '2025-10-01', date '2026-05-31', 'b2b', 'single_room', 55000), ('2025-26', date '2025-10-01', date '2026-05-31', 'foreign', 'single_room', 65000),
    ('2025-26', date '2025-10-01', date '2026-05-31', 'indian', 'single_room', 59000), ('2025-26', date '2025-10-01', date '2026-05-31', 'b2b', 'tour_leader', 40000),
    ('2025-26', date '2025-10-01', date '2026-05-31', 'foreign', 'tour_leader', 46000), ('2025-26', date '2025-10-01', date '2026-05-31', 'indian', 'tour_leader', 43000),
    ('2026-27', date '2026-10-01', date '2027-05-31', 'b2b', 'single_room', 60000), ('2026-27', date '2026-10-01', date '2027-05-31', 'foreign', 'single_room', 70000),
    ('2026-27', date '2026-10-01', date '2027-05-31', 'indian', 'single_room', 65000), ('2026-27', date '2026-10-01', date '2027-05-31', 'b2b', 'tour_leader', 45000),
    ('2026-27', date '2026-10-01', date '2027-05-31', 'foreign', 'tour_leader', 52000), ('2026-27', date '2026-10-01', date '2027-05-31', 'indian', 'tour_leader', 48000)
  ) as v(season, valid_from, valid_to, market, kind, amount)
  on conflict (valid_from, market, kind) do nothing;

  -- ------------------------------------------------------------------ the rules and the guest page text
  insert into public.rp_settings (id, data) values (1, $json${
    "gst_pct": 5,
    "package_nights": 5,
    "min_nights": 4,
    "max_nights": 10,
    "max_guests": 10,
    "max_rooms": 5,
    "min_age": 16,
    "closed_months": [6, 7, 8, 9],
    "deposit_pct": 50,
    "balance_days_before": 45,
    "hotel_property": "Mayfair",
    "airports": [
      { "code": "IXB", "name": "Bagdogra Airport (IXB), Siliguri, India", "hours": 5, "note": "Through India: immigration at the Kakarbhitta border into Nepal." },
      { "code": "BDP", "name": "Bhadrapur (Chandragadhi) Airport (BDP), Nepal", "hours": 3.5, "note": "For guests travelling within Nepal." }
    ],
    "title": "Red Panda Outpost",
    "tagline": "A Pugdundee Safaris experience - an eco-tourism home stay at 9,400 ft",
    "intro": "Tucked away in a small Buddhist village near Singalila National Park, Red Panda Outpost is a remote sanctuary for those drawn to the untamed beauty of the Himalayas. Once a humble teahouse run by a local Gorkha family, it has been thoughtfully reimagined as a homestay - simple, warm, and deeply connected to its surroundings. With just five rooms, each with an attached bathroom, reliable electricity, heating and hot water, and wholesome food made with fresh, seasonal ingredients, it is a comfortable base for an authentic, top-quality wildlife experience: the search for the elusive red panda in the forests of Singalila and Tinchuley.",
    "stay_text": "The heart of the outpost is the old wooden house, where guests gather every evening around a bukhari fire over home-cooked meals. Breakfast is a spread of healthy options with fresh fruit, orthodox tea and moka pot coffee; lunch is a comforting Nepali thali; dinner brings regional favourites with Indian and global options. Single-use plastic and packaged foods have been eliminated to keep the fragile ecosystem of Singalila pristine.",
    "days": [
      { "title": "Arrival and transfer to Red Panda Outpost", "text": "Fly to {airport} and drive to Jaubari village (adjoining Singalila National Park, Nepal), about a {hours}-hour journey. We will be travelling to a remote location on the India - Nepal border, so some buffer time is always helpful: please arrive before 10 AM (an early morning flight is suggested). The last stretch of 1 - 1.5 hours has no metalled road; we travel in comfortable 4x4 Boleros and arrive at the homestay by early evening. The evening is at leisure, with a brief orientation, dinner and overnight at Red Panda Outpost." },
      { "title": "In search of the red panda / birding", "text": "Our expert tracking team leaves early each morning to look for signs of the red panda in the contiguous forests around Singalila National Park in Nepal and India; you may join this morning ritual. After a hearty breakfast, the morning is for birdwatching in an area home to over 350 species of birds. Once the trackers report fresh signs or a sighting, you move to the area with a naturalist - by 4x4 Bolero when the sighting is close to a motorable road, usually followed by a walk through dense forest. A picnic lunch on site or lunch back at the outpost; late afternoons are often misty, for reading or birding around the outpost; evenings by the fire." },
      { "title": "Departure", "text": "After an early breakfast, we say goodbye to the mountains and depart for {departure_airport} to connect your onward flight. Please book departure flights after 5 PM." }
    ],
    "inclusions": [
      "Stay for {nights} nights / {days} days at Red Panda Outpost (Jaubari, Nepal) in well-appointed rooms with attached facilities",
      "All meals and tea / coffee at Red Panda Outpost, with tea / coffee refills. Meals and beverages en route are on direct payment",
      "Pick-up and drop from {airport} with assistance at the India - Nepal border",
      "{expedition_days}-day Red Panda Expedition with tracker support and a naturalist with extensive knowledge of the local flora, fauna and ecosystem",
      "Shared porters and 4x4 Boleros for the entire duration of the stay",
      "Wildlife permit cost and conservation fees",
      "Still camera permits, 1 per person",
      "Trek or visit to Sandakphu top / sightseeing in neighbouring villages (international guests are currently not permitted to Sandakphu top)"
    ],
    "exclusions": [
      "Domestic flight tickets / train tickets",
      "Meals and beverages en route to and from Red Panda Outpost on the day of arrival and departure",
      "Any expense of personal nature (soft or hard beverages, laundry, phone calls, incidentals, porter charges etc.)",
      "Tips and gratuities (entirely as per your discretion - we do not levy service charge in our bills)",
      "Travel insurance",
      "Visa fee",
      "Cost of any supplementary services consumed",
      "Anything not listed in the includes section"
    ],
    "good_to_know": [
      "The journey crosses the India - Nepal border by road at Kakarbhitta: immigration formalities at both ends, and Nepal visa formalities on the way in. Our local representative assists you at both ends. Allow about an hour at each end, plus the transfer of about 5 hours from Bagdogra (about 3.5 hours from Bhadrapur).",
      "The last 1 - 1.5 hours of the drive has no metalled roads; we travel in comfortable 4x4 Boleros.",
      "Red panda sightings are not from the jeep: a moderate level of fitness is needed. Red Panda Outpost is at an altitude of 9,400 ft.",
      "Guests are driven to the closest point (three community forests, 45 minutes to 1 hour 15 minutes away) and then walk 15 - 30 minutes in dense forest to the sighting.",
      "Hikers can trek after breakfast and be driven back (an average trek is 3 - 4 hours).",
      "Foreign guests need a Nepal visa, and a multiple-entry Indian visa if arriving and departing from India. Visa is not required for Indian nationals, but carry either a voter ID or passport in original: it is checked at the border.",
      "All rooms are twin-bedded and there is no laundry service.",
      "If you need a night near Bagdogra on arrival or departure (limited flight connections), we are happy to book a hotel at an additional cost.",
      "Altitude: Singalila ranges from 7,000 to 12,000 ft. Only a small percentage of guests feel altitude sickness for the first one or two days; drink plenty of water, avoid alcohol for the first two days. A few of our staff are trained in basic first aid; a vehicle is available 24x7 and a doctor for consultation virtually. Further medical help is up to 2 hours away, a big hospital about 4 hours.",
      "Weather can change quickly, with strong winds. In winter, nights can reach -5 degrees C and days are around 4 - 5 degrees C: dress in layers.",
      "Mobile networks are patchy and the internet is basic: activate international roaming and share your itinerary with family and friends.",
      "ATMs are available in and around Bagdogra airport and not after that: carry enough cash.",
      "We limit viewing to 30 minutes for a sighting and watch from a safe distance; no climbing trees or sudden movements, and no tape lure for birds.",
      "The homestay and the park are closed during the monsoon (June to September)."
    ],
    "what_to_carry": [
      "Backpack - lightweight, waterproof and comfortable for short treks",
      "Binoculars, and a camera with zoom lens, extra batteries and data cards",
      "Notebook and field guides (Birds of Nepal by Grimmett, Inskipp and Inskipp; Rhododendrons of Singalila National Park by Upakar Rai)",
      "Flashlight / headlamp, and trekking poles (we can also provide locally made bamboo poles)",
      "Waterproof and windproof jacket, moisture-wicking base layers, an insulated fleece or down jacket, hiking pants, gloves and a hat / beanie",
      "Sturdy waterproof hiking boots with a good grip, and extra wool or synthetic socks",
      "Personal medicines and a first aid kit (band-aids, altitude sickness medication, pain relievers), insect repellent, sunscreen and lip balm, rehydration salts",
      "Refillable insulated water bottle"
    ],
    "payment_terms": "For confirmation: {deposit_pct}% deposit at the time of booking and the balance {balance_pct}% {balance_days} days prior to departure."
  }$json$::jsonb)
  on conflict (id) do nothing;
end
$rp$;

notify pgrst, 'reload schema';

-- Check (expected: query_type 1, tariff 60, supplements 12, settings 1, rls_on 6, policies 10)
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sales_queries' and column_name = 'query_type') as query_type,
  (select count(*) from public.rp_tariff) as tariff,
  (select count(*) from public.rp_supplements) as supplements,
  (select count(*) from public.rp_settings) as settings,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity and c.relname like 'rp\_%') as rls_on,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'rp\_%') as policies;

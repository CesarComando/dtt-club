-- =====================================================================
-- DTT Club — Слой 8: запись (бронирование) на тренировки с лимитом мест.
-- Выполнить ПОСЛЕ schema.sql, layer4_crm.sql, layer5_ranks.sql. Идемпотентный.
--
-- Модель:
--   training_venues    — залы (вместимость зала, если тренировку туда перенесли);
--   training_slots     — недельное расписание (день недели, время, лимит мест) —
--                        тренер меняет его здесь, а не в коде;
--   training_sessions  — конкретные занятия на даты (создаются автоматически
--                        на 14 дней вперёд из расписания), у каждого — свой зал и лимит;
--   bookings           — записи учеников.
--
-- Записаться/отменить можно только через функции book_session / cancel_booking:
-- лимит проверяется на сервере под блокировкой строки занятия (SELECT … FOR UPDATE),
-- поэтому при одновременных нажатиях лишний человек не пройдёт.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Залы
-- ---------------------------------------------------------------------
create table if not exists public.training_venues (
  id       text primary key,
  name     text not null,
  address  text,
  capacity integer check (capacity is null or capacity > 0)  -- лимит, когда занятие перенесено в этот зал
);

insert into public.training_venues (id, name, address, capacity) values
  ('club',    'Зал клуба',                     'Dzirnavu iela 20, Daugavpils', null),
  ('olympic', 'Daugavpils Olimpiskais centrs', 'Stadiona iela 1, Daugavpils',  50)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 2. Недельное расписание
-- ---------------------------------------------------------------------
create table if not exists public.training_slots (
  id           text primary key,                       -- напр. 'grappling-tue'
  title        text    not null,
  discipline   text    not null check (discipline in ('grappling', 'mma')),
  weekday      integer not null check (weekday between 1 and 7),  -- ISO: 1 = пн … 7 = вс
  start_time   time    not null,
  end_time     time    not null,
  capacity     integer check (capacity is null or capacity > 0),  -- null = без лимита
  venue_id     text    not null default 'club' references public.training_venues (id),
  alt_venue_id text    references public.training_venues (id),     -- куда тренер может перенести (переключатель в CRM)
  active       boolean not null default true,
  check (end_time > start_time)
);

comment on table public.training_slots is
  'Расписание клуба. Лимит мест и залы меняет тренер (SQL / Supabase Dashboard / CRM).';

-- Расписание из APP_PASSPORT §4. Уже существующие строки не перезаписываем —
-- тренер мог поменять их вручную.
insert into public.training_slots (id, title, discipline, weekday, start_time, end_time, capacity, alt_venue_id, active) values
  ('grappling-tue', 'Grappling · взрослые', 'grappling', 2, '18:00', '20:00', 18, null,      true),
  ('grappling-thu', 'Grappling · взрослые', 'grappling', 4, '18:00', '20:00', 18, null,      true),
  ('grappling-sat', 'Grappling · взрослые', 'grappling', 6, '15:00', '17:00', 18, 'olympic', true),
  ('mma-beg-mon',   'MMA · новички',        'mma',       1, '17:00', '18:30', null, null,    true),
  ('mma-beg-wed',   'MMA · новички',        'mma',       3, '17:00', '18:30', null, null,    true),
  ('mma-beg-fri',   'MMA · новички',        'mma',       5, '17:00', '18:30', null, null,    true),
  ('mma-pro-mon',   'MMA · опытные',        'mma',       1, '19:00', '20:30', null, null,    true),
  ('mma-pro-wed',   'MMA · опытные',        'mma',       3, '19:00', '20:30', null, null,    true),
  ('mma-pro-fri',   'MMA · опытные',        'mma',       5, '19:00', '20:30', null, null,    true),
  -- Детские аккаунты в приложении пока не заводятся — слот выключен.
  ('mma-kids-tue',  'Детское MMA',          'mma',       2, '16:30', '17:45', null, null,    false),
  ('mma-kids-thu',  'Детское MMA',          'mma',       4, '16:30', '17:45', null, null,    false)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 3. Конкретные занятия
-- ---------------------------------------------------------------------
create table if not exists public.training_sessions (
  id        bigint generated always as identity primary key,
  slot_id   text        not null references public.training_slots (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  venue_id  text        not null references public.training_venues (id),
  capacity  integer     check (capacity is null or capacity > 0),
  cancelled boolean     not null default false,
  unique (slot_id, starts_at)
);

create index if not exists training_sessions_starts_idx on public.training_sessions (starts_at);


-- ---------------------------------------------------------------------
-- 4. Записи
-- ---------------------------------------------------------------------
create table if not exists public.bookings (
  id         bigint generated always as identity primary key,
  session_id bigint      not null references public.training_sessions (id) on delete cascade,
  athlete_id uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (session_id, athlete_id)
);

create index if not exists bookings_athlete_idx on public.bookings (athlete_id);


-- ---------------------------------------------------------------------
-- 5. RLS: расписание читают все вошедшие, меняет тренер;
--    записи — свои видит ученик, все видит тренер; писать — через функции.
-- ---------------------------------------------------------------------
alter table public.training_venues   enable row level security;
alter table public.training_slots    enable row level security;
alter table public.training_sessions enable row level security;
alter table public.bookings          enable row level security;

revoke all on public.training_venues, public.training_slots, public.training_sessions, public.bookings
  from anon, authenticated;
grant select on public.training_venues, public.training_slots, public.training_sessions, public.bookings
  to authenticated;
grant insert, update, delete on public.training_venues, public.training_slots, public.training_sessions
  to authenticated;  -- реально пропустит только политика «coach manages»

drop policy if exists "venues: authenticated read" on public.training_venues;
create policy "venues: authenticated read" on public.training_venues
  for select to authenticated using (true);
drop policy if exists "venues: coach manages" on public.training_venues;
create policy "venues: coach manages" on public.training_venues
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "slots: authenticated read" on public.training_slots;
create policy "slots: authenticated read" on public.training_slots
  for select to authenticated using (true);
drop policy if exists "slots: coach manages" on public.training_slots;
create policy "slots: coach manages" on public.training_slots
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "sessions: authenticated read" on public.training_sessions;
create policy "sessions: authenticated read" on public.training_sessions
  for select to authenticated using (true);
drop policy if exists "sessions: coach manages" on public.training_sessions;
create policy "sessions: coach manages" on public.training_sessions
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "bookings: own or coach can read" on public.bookings;
create policy "bookings: own or coach can read" on public.bookings
  for select to authenticated
  using (athlete_id = (select auth.uid()) or (select public.is_admin()));


-- ---------------------------------------------------------------------
-- 6. Лимит занятия по залу: в «родном» зале слота — лимит слота,
--    в другом зале — лимит зала (если задан), иначе лимит слота.
-- ---------------------------------------------------------------------
create or replace function public.session_capacity(p_slot text, p_venue text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.venue_id = p_venue then s.capacity else coalesce(v.capacity, s.capacity) end
    from public.training_slots s
    join public.training_venues v on v.id = p_venue
   where s.id = p_slot;
$$;

-- Тренер поменял лимит или зал слота → обновляем будущие занятия,
-- которые не были перенесены вручную в другой зал.
create or replace function public.training_slots_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.training_sessions ts
     set venue_id = new.venue_id,
         capacity = new.capacity
   where ts.slot_id = new.id
     and ts.starts_at > now()
     and ts.venue_id = old.venue_id;
  return new;
end;
$$;

drop trigger if exists training_slots_sync on public.training_slots;
create trigger training_slots_sync
  after update of capacity, venue_id on public.training_slots
  for each row execute function public.training_slots_sync();


-- ---------------------------------------------------------------------
-- 7. Создать занятия на N дней вперёд из расписания (повторный вызов безопасен)
-- ---------------------------------------------------------------------
create or replace function public.ensure_sessions(p_days integer default 14)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Riga')::date;
begin
  insert into public.training_sessions (slot_id, starts_at, ends_at, venue_id, capacity)
  select s.id,
         (d + s.start_time) at time zone 'Europe/Riga',
         (d + s.end_time)   at time zone 'Europe/Riga',
         s.venue_id,
         s.capacity
    from public.training_slots s
    cross join generate_series(v_today, v_today + least(greatest(p_days, 1), 60), interval '1 day') as g(day)
    cross join lateral (select g.day::date as d) x
   where s.active
     and extract(isodow from d) = s.weekday
  on conflict (slot_id, starts_at) do nothing;
end;
$$;


-- ---------------------------------------------------------------------
-- 8. Ближайшие занятия со счётчиком мест.
--    Ученик видит занятия своего направления, тренер — все.
-- ---------------------------------------------------------------------
drop function if exists public.upcoming_sessions(integer);
create or replace function public.upcoming_sessions(p_days integer default 7)
returns table (
  id            bigint,
  slot_id       text,
  title         text,
  discipline    text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  venue_id      text,
  venue_name    text,
  venue_address text,
  alt_venue_id  text,
  capacity      integer,
  booked        integer,
  is_booked     boolean,
  cancelled     boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean := public.is_admin();
  v_disc  text;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;

  perform public.ensure_sessions(14);
  select p.discipline into v_disc from public.profiles p where p.id = v_uid;

  return query
  select ts.id, ts.slot_id, s.title, s.discipline, ts.starts_at, ts.ends_at,
         ts.venue_id, v.name, v.address, s.alt_venue_id, ts.capacity,
         (select count(*)::integer from public.bookings b where b.session_id = ts.id),
         exists (select 1 from public.bookings b where b.session_id = ts.id and b.athlete_id = v_uid),
         ts.cancelled
    from public.training_sessions ts
    join public.training_slots  s on s.id = ts.slot_id
    join public.training_venues v on v.id = ts.venue_id
   where ts.ends_at > now()
     and ts.starts_at < now() + make_interval(days => least(greatest(p_days, 1), 14))
     and (v_admin or v_disc = 'both' or s.discipline = v_disc)
   order by ts.starts_at;
end;
$$;


-- ---------------------------------------------------------------------
-- 9. Записаться (атомарная проверка лимита)
-- ---------------------------------------------------------------------
create or replace function public.book_session(p_session bigint)
returns integer   -- сколько человек записано после записи
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_session public.training_sessions%rowtype;
  v_disc    text;
  v_slot    text;
  v_booked  integer;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;

  -- Блокируем строку занятия: параллельные записи на это занятие ждут друг друга.
  select * into v_session from public.training_sessions where id = p_session for update;
  if not found then
    raise exception 'Занятие не найдено';
  end if;
  if v_session.cancelled then
    raise exception 'Это занятие отменено';
  end if;
  if v_session.starts_at <= now() then
    raise exception 'Запись закрыта: тренировка уже началась';
  end if;

  select discipline into v_slot from public.training_slots where id = v_session.slot_id;
  select discipline into v_disc from public.profiles where id = v_uid;
  if v_disc is null then
    raise exception 'Профиль не найден';
  end if;
  if v_disc <> 'both' and v_disc <> v_slot and not public.is_admin() then
    raise exception 'Эта тренировка не вашего направления';
  end if;

  if exists (select 1 from public.bookings where session_id = p_session and athlete_id = v_uid) then
    raise exception 'Вы уже записаны';
  end if;

  select count(*) into v_booked from public.bookings where session_id = p_session;
  if v_session.capacity is not null and v_booked >= v_session.capacity then
    raise exception 'Мест нет: записано % из %', v_booked, v_session.capacity using errcode = 'P0001';
  end if;

  insert into public.bookings (session_id, athlete_id) values (p_session, v_uid);
  return v_booked + 1;
end;
$$;


-- ---------------------------------------------------------------------
-- 10. Отменить запись (свою; тренер — любую, передав p_athlete)
-- ---------------------------------------------------------------------
drop function if exists public.cancel_booking(bigint);
create or replace function public.cancel_booking(p_session bigint, p_athlete uuid default null)
returns integer   -- сколько человек осталось
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_target  uuid := coalesce(p_athlete, auth.uid());
  v_starts  timestamptz;
  v_booked  integer;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;
  if v_target <> v_uid and not public.is_admin() then
    raise exception 'Отменить можно только свою запись' using errcode = '42501';
  end if;

  select starts_at into v_starts from public.training_sessions where id = p_session for update;
  if not found then
    raise exception 'Занятие не найдено';
  end if;
  if v_starts <= now() and not public.is_admin() then
    raise exception 'Тренировка уже началась — отменить запись нельзя';
  end if;

  delete from public.bookings where session_id = p_session and athlete_id = v_target;
  if not found then
    raise exception 'Записи нет — отменять нечего';
  end if;

  select count(*) into v_booked from public.bookings where session_id = p_session;
  return v_booked;
end;
$$;


-- ---------------------------------------------------------------------
-- 11. Тренер переносит занятие в другой зал (например, суббота → Олимпийский центр).
--     Лимит пересчитывается по залу: Олимпийский центр 50, свой зал — лимит слота.
-- ---------------------------------------------------------------------
create or replace function public.set_session_venue(p_session bigint, p_venue text)
returns integer   -- новый лимит (null = без лимита)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot text;
  v_cap  integer;
begin
  if not public.is_admin() then
    raise exception 'Только тренер может менять место тренировки' using errcode = '42501';
  end if;
  if not exists (select 1 from public.training_venues where id = p_venue) then
    raise exception 'Зал не найден';
  end if;

  select slot_id into v_slot from public.training_sessions where id = p_session for update;
  if v_slot is null then
    raise exception 'Занятие не найдено';
  end if;

  v_cap := public.session_capacity(v_slot, p_venue);
  update public.training_sessions set venue_id = p_venue, capacity = v_cap where id = p_session;
  return v_cap;
end;
$$;


-- Функции по умолчанию доступны PUBLIC — оставляем только вошедшим.
revoke execute on function
  public.session_capacity(text, text),
  public.training_slots_sync(),
  public.ensure_sessions(integer),
  public.upcoming_sessions(integer),
  public.book_session(bigint),
  public.cancel_booking(bigint, uuid),
  public.set_session_venue(bigint, text)
from public, anon;
grant execute on function
  public.upcoming_sessions(integer),
  public.book_session(bigint),
  public.cancel_booking(bigint, uuid),
  public.set_session_venue(bigint, text)
to authenticated;

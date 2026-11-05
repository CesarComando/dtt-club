-- =====================================================================
-- DTT Club — Слой 15: лимит мест MMA/K1 и «тренируюсь и в другом направлении».
-- Выполнить ПОСЛЕ layer8_booking.sql. Скрипт идемпотентный.
--
-- • Взрослые тренировки MMA/K1 — до 16 человек (было без лимита).
--   Триггер training_slots_sync сам обновит будущие занятия.
-- • profiles.cross_training — ученик сам включает в кабинете, чтобы видеть
--   и записываться на тренировки другого направления. Основное направление
--   (discipline), ранг и абонемент от этого не меняются.
-- =====================================================================

update public.training_slots
   set capacity = 16
 where discipline = 'mma' and active and capacity is distinct from 16;

alter table public.profiles add column if not exists cross_training boolean not null default false;
comment on column public.profiles.cross_training is
  'Ученик видит и может записываться на тренировки другого направления. Абонемент не меняется.';
grant update (cross_training) on public.profiles to authenticated;   -- RLS: только свой профиль


-- Ближайшие занятия: своё направление, а при cross_training — все.
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
  v_cross boolean;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;

  perform public.ensure_sessions(14);
  select p.discipline, p.cross_training into v_disc, v_cross from public.profiles p where p.id = v_uid;

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
     and (v_admin or v_cross or v_disc = 'both' or s.discipline = v_disc)
   order by ts.starts_at;
end;
$$;


-- Запись: то же правило направления, что и в расписании.
create or replace function public.book_session(p_session bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_session public.training_sessions%rowtype;
  v_disc    text;
  v_cross   boolean;
  v_slot    text;
  v_booked  integer;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;

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
  select discipline, cross_training into v_disc, v_cross from public.profiles where id = v_uid;
  if v_disc is null then
    raise exception 'Профиль не найден';
  end if;
  if v_disc <> 'both' and v_disc <> v_slot and not v_cross and not public.is_admin() then
    raise exception 'Эта тренировка не вашего направления — включите другое направление в кабинете';
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

revoke execute on function public.upcoming_sessions(integer), public.book_session(bigint) from public, anon;
grant execute on function public.upcoming_sessions(integer), public.book_session(bigint) to authenticated;

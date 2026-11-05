-- =====================================================================
-- DTT Club — Слой 20: помощник тренера (role = 'coach') с ограниченными правами.
-- Выполнить ПОСЛЕ layer19_gallery.sql. Скрипт идемпотентный.
--
-- Тренер (admin) — все права. Помощник (coach) — только то, что нужно в зале:
--   • отмечать посещения (+1 / отмена), показывать QR-код для чекина;
--   • видеть все занятия и кто записан, убирать запись, переносить зал;
--   • видеть список учеников (имя, селфи, ранг — как и все вошедшие).
-- Помощнику НЕ доступны: оплаты и абонементы, телефоны, ранги и направления,
-- удаление аккаунтов, список учеников клуба, дневники и параметры тела, галерея-модерация.
-- Помощник нигде публично не показывается (не ученик: его нет в списках для оценок и т.п.).
-- Назначает/снимает помощника только тренер — set_staff_role().
-- =====================================================================

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('athlete', 'coach', 'admin'));

-- true для тренера и помощника.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('admin', 'coach')
  );
$$;
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- Тренер назначает помощника (или возвращает в ученики).
create or replace function public.set_staff_role(p_profile uuid, p_coach boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not public.is_admin() then
    raise exception 'Назначать помощника может только тренер' using errcode = '42501';
  end if;
  update public.profiles
     set role = case when p_coach then 'coach' else 'athlete' end,
         approved_at = coalesce(approved_at, now())
   where id = p_profile and role <> 'admin'
  returning role into v_role;
  if v_role is null then
    raise exception 'Пользователь не найден';
  end if;
  return v_role;
end;
$$;
revoke execute on function public.set_staff_role(uuid, boolean) from public, anon;
grant execute on function public.set_staff_role(uuid, boolean) to authenticated;

-- Посещения и записи: помощник читает все.
drop policy if exists "attendance: own or coach can read" on public.attendance;
create policy "attendance: own or coach can read" on public.attendance
  for select to authenticated
  using (athlete_id = (select auth.uid()) or (select public.is_staff()));

drop policy if exists "bookings: own or coach can read" on public.bookings;
create policy "bookings: own or coach can read" on public.bookings
  for select to authenticated
  using (athlete_id = (select auth.uid()) or (select public.is_staff()));

-- Функции зала: проверка роли is_admin() → is_staff() (остальное без изменений).

CREATE OR REPLACE FUNCTION public.mark_attendance(p_athlete uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  if not public.is_staff() then
    raise exception 'Только тренер может отмечать посещаемость' using errcode = '42501';
  end if;

  update public.profiles
     set trainings_count = trainings_count + 1
   where id = p_athlete
  returning trainings_count into v_count;

  if v_count is null then
    raise exception 'Спортсмен не найден';
  end if;

  insert into public.attendance (athlete_id, marked_by) values (p_athlete, auth.uid());
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.undo_attendance(p_athlete uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id    bigint;
  v_count integer;
begin
  if not public.is_staff() then
    raise exception 'Только тренер может отменять отметки' using errcode = '42501';
  end if;

  select id into v_id
    from public.attendance
   where athlete_id = p_athlete
     and created_at >= (date_trunc('day', now() at time zone 'Europe/Riga') at time zone 'Europe/Riga')
   order by created_at desc
   limit 1;

  if v_id is null then
    raise exception 'Сегодня отметок нет — отменять нечего';
  end if;

  delete from public.attendance where id = v_id;

  update public.profiles
     set trainings_count = greatest(trainings_count - 1, 0)
   where id = p_athlete
  returning trainings_count into v_count;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.checkin_qr(p_session bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_token text;
  v_ends  timestamptz;
begin
  if not public.is_staff() then
    raise exception 'Только тренер показывает QR-код' using errcode = '42501';
  end if;

  select ends_at into v_ends from public.training_sessions where id = p_session and not cancelled;
  if v_ends is null then
    raise exception 'Занятие не найдено или отменено';
  end if;

  delete from public.checkin_tokens where expires_at < now() - interval '1 hour';

  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into public.checkin_tokens (token, session_id, expires_at)
  values (v_token, p_session, least(now() + interval '2 minutes', v_ends + interval '30 minutes'));
  return v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.upcoming_sessions(p_days integer DEFAULT 7)
 RETURNS TABLE(id bigint, slot_id text, title text, discipline text, starts_at timestamp with time zone, ends_at timestamp with time zone, venue_id text, venue_name text, venue_address text, alt_venue_id text, capacity integer, booked integer, is_booked boolean, cancelled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean := public.is_staff();
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
$function$;

CREATE OR REPLACE FUNCTION public.set_session_venue(p_session bigint, p_venue text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_slot text;
  v_cap  integer;
begin
  if not public.is_staff() then
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
$function$;

CREATE OR REPLACE FUNCTION public.cancel_booking(p_session bigint, p_athlete uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_target  uuid := coalesce(p_athlete, auth.uid());
  v_starts  timestamptz;
  v_booked  integer;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;
  if v_target <> v_uid and not public.is_staff() then
    raise exception 'Отменить можно только свою запись' using errcode = '42501';
  end if;

  select starts_at into v_starts from public.training_sessions where id = p_session for update;
  if not found then
    raise exception 'Занятие не найдено';
  end if;
  if v_starts <= now() and not public.is_staff() then
    raise exception 'Тренировка уже началась — отменить запись нельзя';
  end if;

  delete from public.bookings where session_id = p_session and athlete_id = v_target;
  if not found then
    raise exception 'Записи нет — отменять нечего';
  end if;

  select count(*) into v_booked from public.bookings where session_id = p_session;
  return v_booked;
end;
$function$;

-- Должники и абонементы — только ученики (помощник не в списках).

CREATE OR REPLACE FUNCTION public.payment_debtors()
 RETURNS TABLE(athlete_id uuid, first_name text, last_name text, reason text, unpaid integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then
    raise exception 'Только для тренера' using errcode = '42501';
  end if;

  return query
  with month_att as (
    select a.athlete_id, count(*)::integer as cnt
      from public.attendance a
     where a.created_at > now() - interval '30 days'
     group by a.athlete_id
  ),
  first_att as (
    select a.athlete_id, min(a.created_at) as first_at
      from public.attendance a group by a.athlete_id
  ),
  singles as (
    select p.user_id, count(*)::integer as cnt
      from public.payments p
      join public.payment_products pr on pr.id = p.product_id
     where pr.kind = 'single' and p.status = 'paid' and p.created_at > now() - interval '30 days'
     group by p.user_id
  ),
  card_live as (
    select s.user_id, s.status
      from public.subscriptions s
      join public.payment_products pr on pr.id = s.product_id
     where pr.kind = 'membership' and s.status in ('active', 'trialing', 'past_due', 'unpaid')
  ),
  cash_live as (
    select distinct p.user_id from public.payments p
     where p.method = 'cash' and p.status = 'paid' and p.period_end > now()
  ),
  bank_live as (
    select m.profile_id as user_id from public.club_members m
     where m.profile_id is not null
       and public.member_membership_until(m.id) >= (now() at time zone 'Europe/Riga')::date
  )
  select pf.id, pf.first_name, pf.last_name,
         case when cl.status in ('past_due', 'unpaid') then 'Не прошло списание абонемента'
              else 'Тренировки без оплаты' end,
         case when cl.status in ('past_due', 'unpaid') then null
              else ma.cnt - coalesce(sg.cnt, 0)
                   - (case when fa.first_at > now() - interval '30 days' then 1 else 0 end) end
    from public.profiles pf
    left join month_att ma on ma.athlete_id = pf.id
    left join first_att fa on fa.athlete_id = pf.id
    left join singles   sg on sg.user_id = pf.id
    left join card_live cl on cl.user_id = pf.id
    left join cash_live cs on cs.user_id = pf.id
    left join bank_live bl on bl.user_id = pf.id
   where pf.role = 'athlete'
     and (
       cl.status in ('past_due', 'unpaid')
       or (cl.user_id is null and cs.user_id is null and bl.user_id is null
           and coalesce(ma.cnt, 0) - coalesce(sg.cnt, 0)
               - (case when fa.first_at > now() - interval '30 days' then 1 else 0 end) > 0)
     )
   order by pf.last_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.membership_overview(p_only_me boolean DEFAULT false)
 RETURNS TABLE(member_id bigint, profile_id uuid, first_name text, last_name text, discipline text, last_paid date, valid_until date, source text, active boolean, single_price_cents integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;
  if not p_only_me and not public.is_admin() then
    raise exception 'Только для тренера' using errcode = '42501';
  end if;

  return query
  with people as (
    -- ученики клуба (+ связанный аккаунт) и аккаунты без записи в клубе
    select m.id as mid, m.profile_id as pid, m.first_name as fn, m.last_name as ln,
           coalesce(p.discipline, m.discipline) as disc, m.single_price_cents as spc
      from public.club_members m
      left join public.profiles p on p.id = m.profile_id
    union all
    select null, p.id, p.first_name, p.last_name, p.discipline, null
      from public.profiles p
     where p.role = 'athlete'
       and not exists (select 1 from public.club_members m where m.profile_id = p.id)
  ),
  sources as (
    select pe.mid, pe.pid, 'bank'::text as src,
           (select max(mp.paid_on) from public.member_payments mp
             where mp.member_id = pe.mid and mp.kind = 'membership') as paid,
           public.member_membership_until(pe.mid) as until
      from people pe where pe.mid is not null
    union all
    select pe.mid, pe.pid, 'cash',
           (max(pa.created_at) at time zone 'Europe/Riga')::date,
           (max(pa.period_end) at time zone 'Europe/Riga')::date
      from people pe
      join public.payments pa on pa.user_id = pe.pid
     where pa.method = 'cash' and pa.status = 'paid' and pa.period_end is not null
     group by pe.mid, pe.pid
    union all
    select pe.mid, pe.pid, 'card',
           ((max(s.current_period_end) - interval '1 month') at time zone 'Europe/Riga')::date,  -- начало текущего периода
           (max(s.current_period_end) at time zone 'Europe/Riga')::date
      from people pe
      join public.subscriptions s on s.user_id = pe.pid
      join public.payment_products pr on pr.id = s.product_id
     where pr.kind = 'membership' and s.status in ('active', 'trialing', 'past_due')
     group by pe.mid, pe.pid
  ),
  best as (
    select distinct on (coalesce(so.mid::text, so.pid::text))
           so.mid, so.pid, so.src, so.paid, so.until
      from sources so
     where so.until is not null
     order by coalesce(so.mid::text, so.pid::text), so.until desc
  )
  select pe.mid, pe.pid, pe.fn, pe.ln, pe.disc, b.paid, b.until, b.src,
         coalesce(b.until >= (now() at time zone 'Europe/Riga')::date, false),
         pe.spc
    from people pe
    left join best b on coalesce(b.mid::text, b.pid::text) = coalesce(pe.mid::text, pe.pid::text)
   where not p_only_me or pe.pid = v_uid
   order by (b.until is null), b.until desc, pe.ln, pe.fn;
end;
$function$;

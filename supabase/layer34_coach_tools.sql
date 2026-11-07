-- =====================================================================
-- DTT Club — Слой 34: уведомления, напоминания, статистика, пробные.
-- Выполнить ПОСЛЕ layer33. Скрипт идемпотентный.
--
-- A. notifications         — уведомления в приложении. Тренер отменил /
--                             вернул / перенёс тренировку или сменил зал —
--                             всем записанным (и их родителям) приходит запись.
--    set_session_cancelled — тренер отменяет занятие (с причиной) / возвращает.
-- B. membership_reminders() — кому напомнить о продлении (кончается ≤ 3 дн.
--                             или закончился ≤ 7 дн. назад) + телефон для WhatsApp.
--    mark_membership_reminded — отметка «напомнил», чтобы не писать дважды.
-- C. coach_stats(), inactive_athletes() — посещаемость по неделям и кто
--                             перестал ходить.
-- D. trial_requests + request_trial() — заявка на бесплатную пробную
--                             тренировку без входа (с сайта клуба).
-- Всё, кроме уведомлений и заявки, — только для главного тренера (is_admin).
-- =====================================================================

-- Телефон для связи: свой номер, у ребёнка — номер родителя.
create or replace function public.contact_phone(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when pc.phone ~ '^[0-9]{8,15}$' then pc.phone else ppc.phone end
    from public.profiles p
    left join public.profile_contacts pc  on pc.id = p.id
    left join public.profile_contacts ppc on ppc.id = p.parent_id
   where p.id = p_profile;
$$;
revoke execute on function public.contact_phone(uuid) from public, anon, authenticated;


-- A. Уведомления ------------------------------------------------------
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  kind       text        not null,
  title      text        not null,
  body       text        not null default '',
  session_id bigint      references public.training_sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists "notifications: own read" on public.notifications;
create policy "notifications: own read" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "notifications: own mark read" on public.notifications;
create policy "notifications: own mark read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.training_sessions add column if not exists cancel_reason text;

-- Тренер: отменить занятие (с причиной) или вернуть его в расписание.
create or replace function public.set_session_cancelled(p_session bigint, p_cancelled boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Только тренер может отменять тренировки' using errcode = '42501';
  end if;
  update public.training_sessions
     set cancelled = p_cancelled,
         cancel_reason = case when p_cancelled then nullif(left(trim(p_reason), 200), '') end
   where id = p_session and ends_at > now();
  if not found then
    raise exception 'Занятие не найдено или уже прошло';
  end if;
end;
$$;
revoke execute on function public.set_session_cancelled(bigint, boolean, text) from public, anon;
grant execute on function public.set_session_cancelled(bigint, boolean, text) to authenticated;

-- Триггер: изменилось занятие → уведомить записанных и их родителей.
create or replace function public.notify_session_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_when  text := to_char(old.starts_at at time zone 'Europe/Riga', 'DD.MM HH24:MI');
  v_kind  text;
  v_head  text;
  v_body  text;
  v_vname text;
  v_vaddr text;
begin
  if new.ends_at <= now() then
    return new;
  end if;
  select s.title into v_title from public.training_slots s where s.id = new.slot_id;

  if new.cancelled and not old.cancelled then
    v_kind := 'cancelled';
    v_head := 'Тренировка отменена';
    v_body := v_title || ', ' || v_when || coalesce('. ' || new.cancel_reason, '');
  elsif old.cancelled and not new.cancelled then
    v_kind := 'restored';
    v_head := 'Тренировка снова в расписании';
    v_body := v_title || ', ' || v_when;
  elsif new.starts_at is distinct from old.starts_at then
    v_kind := 'moved';
    v_head := 'Тренировка перенесена';
    v_body := v_title || ': ' || v_when || ' → ' || to_char(new.starts_at at time zone 'Europe/Riga', 'DD.MM HH24:MI');
  elsif new.venue_id is distinct from old.venue_id then
    select v.name, v.address into v_vname, v_vaddr from public.training_venues v where v.id = new.venue_id;
    v_kind := 'venue';
    v_head := 'Тренировка в другом зале';
    v_body := v_title || ', ' || v_when || ' — ' || v_vname || coalesce(', ' || v_vaddr, '');
  else
    return new;
  end if;

  insert into public.notifications (user_id, kind, title, body, session_id)
  select x.uid, v_kind, v_head, v_body, new.id
    from (
      select b.athlete_id as uid from public.bookings b where b.session_id = new.id
      union
      select p.parent_id from public.bookings b
        join public.profiles p on p.id = b.athlete_id
       where b.session_id = new.id and p.parent_id is not null
    ) x;
  return new;
end;
$$;
revoke execute on function public.notify_session_change() from public, anon, authenticated;

drop trigger if exists training_sessions_notify on public.training_sessions;
create trigger training_sessions_notify
  after update of cancelled, starts_at, venue_id on public.training_sessions
  for each row execute function public.notify_session_change();


-- B. Напоминания о продлении абонемента -------------------------------
create table if not exists public.membership_reminders (
  target      text        not null,   -- 'm<member_id>' или 'p<profile_id>'
  valid_until date        not null,
  reminded_at timestamptz not null default now(),
  primary key (target, valid_until)
);
alter table public.membership_reminders enable row level security;
revoke all on public.membership_reminders from anon, authenticated;

create or replace function public.membership_reminders()
returns table (member_id bigint, profile_id uuid, first_name text, last_name text, phone text,
               valid_until date, days_left integer, reminded_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Riga')::date;
begin
  if not public.is_admin() then
    raise exception 'Только для тренера' using errcode = '42501';
  end if;
  return query
  select o.member_id, o.profile_id, o.first_name, o.last_name,
         coalesce(m.phone, case when o.profile_id is not null then public.contact_phone(o.profile_id) end),
         o.valid_until, (o.valid_until - v_today)::integer, r.reminded_at
    from public.membership_overview(false) o
    left join public.club_members m on m.id = o.member_id
    left join public.membership_reminders r
           on r.target = coalesce('m' || o.member_id::text, 'p' || o.profile_id::text)
          and r.valid_until = o.valid_until
   where o.valid_until between v_today - 7 and v_today + 3
     and not (o.source = 'card' and o.active)        -- карта продлится сама
   order by o.valid_until, o.last_name;
end;
$$;
revoke execute on function public.membership_reminders() from public, anon;
grant execute on function public.membership_reminders() to authenticated;

create or replace function public.mark_membership_reminded(p_member bigint, p_profile uuid, p_until date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Только для тренера' using errcode = '42501';
  end if;
  insert into public.membership_reminders (target, valid_until)
  values (coalesce('m' || p_member::text, 'p' || p_profile::text), p_until)
  on conflict (target, valid_until) do update set reminded_at = now();
end;
$$;
revoke execute on function public.mark_membership_reminded(bigint, uuid, date) from public, anon;
grant execute on function public.mark_membership_reminded(bigint, uuid, date) to authenticated;


-- C. Статистика -------------------------------------------------------
-- Посещения по неделям (пн–вс) за последние p_weeks недель, пустые недели — нулём.
create or replace function public.coach_stats(p_weeks integer default 12)
returns table (week_start date, visits integer, people integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := date_trunc('week', now() at time zone 'Europe/Riga')::date
                 - 7 * (least(greatest(p_weeks, 1), 52) - 1);
begin
  if not public.is_admin() then
    raise exception 'Только для тренера' using errcode = '42501';
  end if;
  return query
  select w.d::date,
         count(a.athlete_id)::integer,
         count(distinct a.athlete_id)::integer
    from generate_series(v_from, (now() at time zone 'Europe/Riga')::date, interval '7 days') as w(d)
    left join public.attendance a
           on (a.created_at at time zone 'Europe/Riga')::date >= w.d::date
          and (a.created_at at time zone 'Europe/Riga')::date <  w.d::date + 7
   group by w.d
   order by w.d;
end;
$$;
revoke execute on function public.coach_stats(integer) from public, anon;
grant execute on function public.coach_stats(integer) to authenticated;

-- Кто перестал ходить: был на 3+ тренировках, последняя — от p_days до 120 дней назад.
create or replace function public.inactive_athletes(p_days integer default 14)
returns table (profile_id uuid, first_name text, last_name text, phone text,
               last_visit date, visits integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Только для тренера' using errcode = '42501';
  end if;
  return query
  select p.id, p.first_name, p.last_name, public.contact_phone(p.id),
         (max(a.created_at) at time zone 'Europe/Riga')::date,
         count(*)::integer
    from public.profiles p
    join public.attendance a on a.athlete_id = p.id
   where p.role = 'athlete'
   group by p.id
  having count(*) >= 3
     and max(a.created_at) <  now() - make_interval(days => greatest(p_days, 1))
     and max(a.created_at) >= now() - interval '120 days'
   order by max(a.created_at) desc;
end;
$$;
revoke execute on function public.inactive_athletes(integer) from public, anon;
grant execute on function public.inactive_athletes(integer) to authenticated;


-- D. Заявки на пробную тренировку -------------------------------------
create table if not exists public.trial_requests (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name       text        not null check (char_length(name) between 2 and 80),
  phone      text        not null check (phone ~ '^[0-9]{8,15}$'),
  discipline text        not null check (discipline in ('mma', 'k1', 'grappling', 'kids')),
  age        smallint    check (age between 4 and 90),
  preferred  text        check (char_length(preferred) <= 200),
  status     text        not null default 'new' check (status in ('new', 'contacted', 'came', 'declined')),
  note       text        check (char_length(note) <= 500)
);
create index if not exists trial_requests_created_idx on public.trial_requests (created_at desc);
alter table public.trial_requests enable row level security;
revoke all on public.trial_requests from anon, authenticated;
grant select, delete on public.trial_requests to authenticated;
grant update (status, note) on public.trial_requests to authenticated;

drop policy if exists "trial_requests: coach" on public.trial_requests;
create policy "trial_requests: coach" on public.trial_requests
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Заявка без входа. Защита от спама: тот же номер — не чаще раза в сутки
-- (повтор молча принимается), всего — не больше 20 заявок в час.
-- Заявки старше 180 дней удаляются (политика конфиденциальности).
create or replace function public.request_trial(
  p_name text, p_phone text, p_discipline text, p_age integer default null, p_preferred text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_name  text := left(trim(coalesce(p_name, '')), 80);
begin
  if length(v_phone) = 8 then
    v_phone := '371' || v_phone;           -- латвийский номер без кода
  end if;
  if v_phone !~ '^[0-9]{8,15}$' then
    raise exception 'Проверьте номер телефона' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'Укажите имя' using errcode = '22023';
  end if;
  if p_discipline not in ('mma', 'k1', 'grappling', 'kids') then
    raise exception 'Выберите направление' using errcode = '22023';
  end if;

  delete from public.trial_requests where created_at < now() - interval '180 days';

  if exists (select 1 from public.trial_requests
              where phone = v_phone and created_at > now() - interval '1 day') then
    return;
  end if;
  if (select count(*) from public.trial_requests where created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Сейчас слишком много заявок — позвоните или напишите тренеру в WhatsApp' using errcode = 'P0001';
  end if;

  insert into public.trial_requests (name, phone, discipline, age, preferred)
  values (v_name, v_phone, p_discipline,
          case when p_age between 4 and 90 then p_age end,
          nullif(left(trim(coalesce(p_preferred, '')), 200), ''));
end;
$$;
revoke execute on function public.request_trial(text, text, text, integer, text) from public;
grant execute on function public.request_trial(text, text, text, integer, text) to anon, authenticated;

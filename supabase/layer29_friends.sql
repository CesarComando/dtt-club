-- =====================================================================
-- DTT Club — Слой 29: «Позвать друга» из зарегистрированных + скрытый профиль.
-- Выполнить ПОСЛЕ layer28_articles.sql. Скрипт идемпотентный.
--
-- 1. Чужие профили ученик больше не читает из таблицы profiles напрямую.
--    Таблицу видят: сам владелец, тренер/помощник, родитель (свои дети).
--    Остальным — функция club_people(): имя и фото всех учеников, а направление,
--    ранг и число тренировок — только у тех, кто не скрыл профиль.
--    Телефоны, как и раньше, видит только тренер (profile_contacts).
-- 2. profiles.hide_profile — ученик сам скрывает профиль (кроме имени и фото).
-- 3. friend_invites — приглашение на тренировку внутри приложения:
--    выбрал друга из списка → у друга в кабинете «X зовёт тебя» → «Записаться».
--    Детские аккаунты (parent_id) в общий список не попадают — их нельзя позвать.
-- =====================================================================

alter table public.profiles add column if not exists hide_profile boolean not null default false;
comment on column public.profiles.hide_profile is
  'Ученик скрыл профиль: другие ученики видят только имя и фото.';
grant update (hide_profile) on public.profiles to authenticated;   -- RLS: только свой

drop policy if exists "profiles: authenticated can read all" on public.profiles;
create policy "profiles: authenticated can read all" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_staff())
    or parent_id = (select auth.uid())
  );


-- Ученики клуба для других учеников (список «позвать друга», оценки, авторы в галерее).
create or replace function public.club_people()
returns table (
  id              uuid,
  first_name      text,
  last_name       text,
  avatar_url      text,
  hidden          boolean,
  discipline      text,     -- null, если профиль скрыт
  rank_override   smallint, -- null, если скрыт
  trainings_count integer   -- null, если скрыт
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.first_name, p.last_name, p.avatar_url, p.hide_profile,
         case when p.hide_profile then null else p.discipline end,
         case when p.hide_profile then null else p.rank_override end,
         case when p.hide_profile then null else p.trainings_count end
    from public.profiles p
   where (select auth.uid()) is not null
     and p.role = 'athlete'
     and p.parent_id is null
   order by p.first_name, p.last_name;
$$;
revoke execute on function public.club_people() from public, anon;
grant execute on function public.club_people() to authenticated;


-- ---------------------------------------------------------------------
-- Приглашения внутри приложения
-- ---------------------------------------------------------------------
create table if not exists public.friend_invites (
  id          bigint generated always as identity primary key,
  session_id  bigint      not null references public.training_sessions (id) on delete cascade,
  from_id     uuid        not null references public.profiles (id) on delete cascade,
  to_id       uuid        not null references public.profiles (id) on delete cascade,
  status      text        not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at  timestamptz not null default now(),
  answered_at timestamptz,
  unique (session_id, from_id, to_id),
  check (from_id <> to_id)
);
create index if not exists friend_invites_to_idx on public.friend_invites (to_id, status);

alter table public.friend_invites enable row level security;
revoke all on public.friend_invites from anon, authenticated;
grant select on public.friend_invites to authenticated;   -- писать — только через функции

drop policy if exists "friend invites: mine or coach" on public.friend_invites;
create policy "friend invites: mine or coach" on public.friend_invites
  for select to authenticated
  using (from_id = (select auth.uid()) or to_id = (select auth.uid()) or (select public.is_staff()));


-- Позвать друга (ученика из списка) на занятие.
create or replace function public.invite_friend(p_session bigint, p_to uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  bigint;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;
  if p_to = v_uid then
    raise exception 'Себя позвать нельзя';
  end if;
  if not exists (select 1 from public.profiles where id = p_to and role = 'athlete' and parent_id is null) then
    raise exception 'Этого ученика позвать нельзя';
  end if;
  if not exists (select 1 from public.training_sessions where id = p_session and not cancelled and starts_at > now()) then
    raise exception 'На это занятие уже нельзя позвать: оно прошло или отменено';
  end if;
  if exists (select 1 from public.bookings where session_id = p_session and athlete_id = p_to) then
    raise exception 'Он уже записан на эту тренировку';
  end if;
  -- защита от спама: не больше 30 приглашений в сутки от одного ученика
  if (select count(*) from public.friend_invites where from_id = v_uid and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Слишком много приглашений за сутки';
  end if;

  insert into public.friend_invites (session_id, from_id, to_id)
  values (p_session, v_uid, p_to)
  on conflict (session_id, from_id, to_id) do update set status = 'pending', answered_at = null, created_at = now()
  returning id into v_id;
  return v_id;
end;
$$;


-- Мои входящие приглашения (с именем пригласившего и занятием).
create or replace function public.my_friend_invites()
returns table (
  id            bigint,
  session_id    bigint,
  starts_at     timestamptz,
  ends_at       timestamptz,
  title         text,
  venue_name    text,
  from_name     text,
  booked        integer,
  capacity      integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select fi.id, ts.id, ts.starts_at, ts.ends_at, sl.title, v.name,
         p.first_name || ' ' || left(p.last_name, 1) || '.',
         (select count(*)::integer from public.bookings b where b.session_id = ts.id),
         ts.capacity
    from public.friend_invites fi
    join public.training_sessions ts on ts.id = fi.session_id
    join public.training_slots sl on sl.id = ts.slot_id
    join public.training_venues v on v.id = ts.venue_id
    join public.profiles p on p.id = fi.from_id
   where fi.to_id = (select auth.uid())
     and fi.status = 'pending'
     and not ts.cancelled
     and ts.starts_at > now()
   order by ts.starts_at;
$$;


-- Ответить: «Записаться» (запись без проверки направления, лимит мест — да) или «Не смогу».
create or replace function public.answer_friend_invite(p_invite bigint, p_accept boolean)
returns integer   -- сколько записано после ответа (null при отказе)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_inv     public.friend_invites%rowtype;
  v_session public.training_sessions%rowtype;
  v_booked  integer;
begin
  select * into v_inv from public.friend_invites where id = p_invite and to_id = v_uid;
  if not found then
    raise exception 'Приглашение не найдено';
  end if;

  if not p_accept then
    update public.friend_invites set status = 'declined', answered_at = now() where id = p_invite;
    return null;
  end if;

  select * into v_session from public.training_sessions where id = v_inv.session_id for update;
  if v_session.cancelled then
    raise exception 'Это занятие отменено';
  end if;
  if v_session.starts_at <= now() then
    raise exception 'Запись закрыта: тренировка уже началась';
  end if;
  if not exists (select 1 from public.bookings where session_id = v_session.id and athlete_id = v_uid) then
    select count(*) into v_booked from public.bookings where session_id = v_session.id;
    if v_session.capacity is not null and v_booked >= v_session.capacity then
      raise exception 'Мест нет: записано % из %', v_booked, v_session.capacity using errcode = 'P0001';
    end if;
    insert into public.bookings (session_id, athlete_id, invited_by) values (v_session.id, v_uid, v_inv.from_id);
  end if;
  update public.friend_invites set status = 'accepted', answered_at = now() where id = p_invite;
  select count(*) into v_booked from public.bookings where session_id = v_session.id;
  return v_booked;
end;
$$;

revoke execute on function
  public.invite_friend(bigint, uuid),
  public.my_friend_invites(),
  public.answer_friend_invite(bigint, boolean)
from public, anon;
grant execute on function
  public.invite_friend(bigint, uuid),
  public.my_friend_invites(),
  public.answer_friend_invite(bigint, boolean)
to authenticated;

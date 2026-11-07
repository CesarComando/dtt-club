-- =====================================================================
-- DTT Club — Слой 33: закрываем две дыры регистрации + «Кто идёт» приватнее.
-- Выполнить ПОСЛЕ layer32. Скрипт идемпотентный.
--
-- Корень проблемы: номер телефона при регистрации не проверяется (нет SMS),
-- поэтому «телефон совпал» ничего не доказывает.
--
-- 1. Автосвязка аккаунта с учеником клуба по телефону — ВЫКЛЮЧЕНА.
--    Раньше чужой человек мог зарегистрироваться с номером ученика и сразу
--    получить его карточку (заметки, оплаты, телефон родителя).
--    Теперь тренер видит подсказку «📞 совпадает телефон» и связывает сам.
-- 2. Детский аккаунт (логин «<телефон родителя>-N») создаётся ТОЛЬКО через
--    Edge Function create-child от имени вошедшего родителя. Функция сначала
--    кладёт «разрешение» в child_grants (писать туда может только сервер,
--    service_role), затем создаёт пользователя; триггер разрешение проверяет
--    и сразу удаляет. Регистрация из браузера с таким логином отклоняется.
-- 3. session_attendees: имена и фото — только тем, кто сам (или его ребёнок)
--    записан на это занятие, и тренерам. Остальным — только число «Идут: N».
-- =====================================================================

-- 1. Автосвязка по телефону выключена ----------------------------------
drop trigger if exists profile_contacts_auto_link on public.profile_contacts;
revoke execute on function public.auto_link_member() from public, anon, authenticated;


-- 2. Дети — только через create-child ----------------------------------
-- Одноразовое разрешение на детский логин (живёт 5 минут). Клиентского доступа нет.
create table if not exists public.child_grants (
  login      text        primary key,              -- «<телефон родителя>-N»
  parent_id  uuid        not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '5 minutes'
);
alter table public.child_grants enable row level security;
revoke all on public.child_grants from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discipline text := coalesce(nullif(new.raw_user_meta_data ->> 'discipline', ''), 'grappling');
  v_login      text := split_part(new.email, '@', 1);
  v_parent     uuid;
begin
  if v_discipline not in ('grappling', 'mma', 'both') then
    v_discipline := 'grappling';
  end if;

  -- Детский логин «<телефон родителя>-<номер>»: нужно разрешение от create-child.
  if v_login ~ '^[0-9]{8,15}-[0-9]{1,2}$' then
    delete from public.child_grants g
     where g.login = v_login and g.expires_at > now()
    returning g.parent_id into v_parent;
    if v_parent is null then
      raise exception 'Ребёнка добавляет родитель в своём кабинете' using errcode = '42501';
    end if;
    -- Перепроверка: логин ребёнка = телефон этого родителя, и родитель сам не ребёнок.
    if not exists (
      select 1 from auth.users u join public.profiles p on p.id = u.id
       where u.id = v_parent
         and u.email = split_part(v_login, '-', 1) || '@dtt.local'
         and p.parent_id is null
    ) then
      raise exception 'Аккаунт родителя не найден' using errcode = '23503';
    end if;
  end if;

  insert into public.profiles (id, first_name, last_name, discipline, parent_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    v_discipline,
    v_parent
  );
  -- Телефон = логин (у ребёнка — «телефон родителя-номер»), не из metadata.
  insert into public.profile_contacts (id, phone) values (new.id, v_login);
  return new;
end;
$$;


-- 3. «Кто идёт» — имена только своим ------------------------------------
create or replace function public.session_attendees(p_sessions bigint[])
returns table (
  session_id   bigint,
  athlete_id   uuid,      -- null для строки-итога по скрытым
  first_name   text,
  last_name    text,
  avatar_url   text,
  hidden_count integer    -- только в строке-итоге (athlete_id is null)
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid, public.is_staff() as staff
  ),
  -- Занятия, где записан сам спрашивающий или его ребёнок.
  mine as (
    select distinct bk.session_id
      from public.bookings bk, me
     where bk.session_id = any (p_sessions)
       and (bk.athlete_id = me.uid
            or bk.athlete_id in (select c.id from public.profiles c where c.parent_id = me.uid))
  ),
  b as (
    select bk.session_id, p.id, p.first_name, p.last_name, p.avatar_url,
           (p.hide_profile or p.parent_id is not null
            or not (me.staff or bk.session_id in (select m.session_id from mine m))) as hid
      from public.bookings bk
      join public.training_sessions ts on ts.id = bk.session_id
      join public.profiles p on p.id = bk.athlete_id
      cross join me
     where me.uid is not null
       and bk.session_id = any (p_sessions)
       and not ts.cancelled
       and ts.ends_at > now()
  )
  select session_id, id, first_name, last_name, avatar_url, null::integer
    from b where not hid
  union all
  select session_id, null, null, null, null, count(*)::integer
    from b where hid group by session_id
  order by 1, 3 nulls last, 4;
$$;
revoke execute on function public.session_attendees(bigint[]) from public, anon;
grant execute on function public.session_attendees(bigint[]) to authenticated;

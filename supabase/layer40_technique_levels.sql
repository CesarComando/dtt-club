-- =====================================================================
-- DTT Club — Слой 40: три уровня приёма + тема месяца.
-- Выполнить ПОСЛЕ layer13. Скрипт идемпотентный.
--
-- Уровни (user_learned_techniques.status):
--   learning  — изучаю
--   drill     — получается на дрилле
--   mastered  — получается в спарринге (ставит ученик, ПОДТВЕРЖДАЕТ тренер:
--               confirmed_at; пока не подтверждено — «ждёт подтверждения»)
-- Ученик сам не может проставить подтверждение — это сбрасывает триггер.
--
-- club_focus — тема периода («Удушающие руками», ноябрь–февраль) со списком
-- приёмов. Читают все вошедшие, меняет главный тренер.
-- focus_progress(id) — сколько учеников на каком уровне по каждому приёму темы
-- (только числа, без имён).
-- =====================================================================

alter table public.user_learned_techniques drop constraint if exists user_learned_techniques_status_check;
alter table public.user_learned_techniques add constraint user_learned_techniques_status_check
  check (status in ('learning', 'drill', 'mastered'));
alter table public.user_learned_techniques add column if not exists confirmed_at timestamptz;
alter table public.user_learned_techniques add column if not exists confirmed_by uuid references public.profiles (id) on delete set null;

-- Подтверждение ставит только тренер (через confirm_technique); ученик сменил уровень — подтверждение снимается.
create or replace function public.learned_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('dtt.confirming', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = old.status and new.status = 'mastered' then
    new.confirmed_at := old.confirmed_at;
    new.confirmed_by := old.confirmed_by;
  else
    new.confirmed_at := null;
    new.confirmed_by := null;
  end if;
  return new;
end;
$$;
drop trigger if exists learned_guard on public.user_learned_techniques;
create trigger learned_guard before insert or update on public.user_learned_techniques
  for each row execute function public.learned_guard();

-- Тренер: подтвердить «в спарринге» (p_ok = true) или вернуть на «дрилл» (false).
create or replace function public.confirm_technique(p_user uuid, p_technique bigint, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Только для тренера' using errcode = '42501';
  end if;
  perform set_config('dtt.confirming', '1', true);
  if p_ok then
    update public.user_learned_techniques
       set confirmed_at = now(), confirmed_by = auth.uid(), updated_at = now()
     where user_id = p_user and technique_id = p_technique and status = 'mastered';
  else
    update public.user_learned_techniques
       set status = 'drill', confirmed_at = null, confirmed_by = null, updated_at = now()
     where user_id = p_user and technique_id = p_technique;
  end if;
  perform set_config('dtt.confirming', '', true);
end;
$$;
revoke execute on function public.confirm_technique(uuid, bigint, boolean) from public, anon;
grant execute on function public.confirm_technique(uuid, bigint, boolean) to authenticated;

-- Тренер: кто ждёт подтверждения «в спарринге».
create or replace function public.pending_technique_confirmations()
returns table (user_id uuid, first_name text, last_name text, technique_id bigint, technique text, since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.user_id, p.first_name, p.last_name, l.technique_id, d.name, l.updated_at
    from public.user_learned_techniques l
    join public.profiles p on p.id = l.user_id
    join public.techniques_dictionary d on d.id = l.technique_id
   where public.is_admin() and l.status = 'mastered' and l.confirmed_at is null
   order by l.updated_at;
$$;
revoke execute on function public.pending_technique_confirmations() from public, anon;
grant execute on function public.pending_technique_confirmations() to authenticated;

-- Тема периода.
create table if not exists public.club_focus (
  id            bigint generated always as identity primary key,
  title         text   not null,
  discipline    text   not null default 'grappling' check (discipline in ('grappling', 'mma', 'both')),
  starts_on     date   not null,
  ends_on       date   not null check (ends_on >= starts_on),
  technique_ids bigint[] not null default '{}',
  note          text,
  created_at    timestamptz not null default now()
);
alter table public.club_focus enable row level security;
revoke all on public.club_focus from anon;
grant select, insert, update, delete on public.club_focus to authenticated;
drop policy if exists "focus: read" on public.club_focus;
create policy "focus: read" on public.club_focus for select to authenticated using (true);
drop policy if exists "focus: head coach writes" on public.club_focus;
create policy "focus: head coach writes" on public.club_focus for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Прогресс группы по приёмам темы: только числа.
create or replace function public.focus_progress(p_focus bigint)
returns table (technique_id bigint, learning integer, drill integer, sparring integer)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id,
         count(*) filter (where l.status = 'learning')::int,
         count(*) filter (where l.status = 'drill')::int,
         count(*) filter (where l.status = 'mastered' and l.confirmed_at is not null)::int
    from public.club_focus f
    cross join lateral unnest(f.technique_ids) as t(id)
    left join public.user_learned_techniques l on l.technique_id = t.id
   where f.id = p_focus and auth.uid() is not null
   group by t.id;
$$;
revoke execute on function public.focus_progress(bigint) from public, anon;
grant execute on function public.focus_progress(bigint) to authenticated;

-- Тема ноябрь 2026 – февраль 2027: удушающие руками (без треугольника ногами и удушения воротом).
insert into public.club_focus (title, discipline, starts_on, ends_on, technique_ids)
select 'Удушающие руками', 'grappling', date '2026-11-01', date '2027-02-28',
       array(select id from public.techniques_dictionary
              where name in ('Удушение сзади (rear naked choke)', 'Гильотина', 'Д''Арс', 'Анаконда', 'Удушение руками (arm triangle)')
              order by id)
 where not exists (select 1 from public.club_focus where title = 'Удушающие руками' and starts_on = date '2026-11-01');

-- Главный тренер отмечает свои приёмы — подтверждать самому себе не нужно (уже применено как layer40b).
create or replace function public.learned_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('dtt.confirming', true), '') = '1' then
    return new;
  end if;
  if new.status = 'mastered' and new.user_id = auth.uid() and public.is_admin() then
    new.confirmed_at := coalesce(new.confirmed_at, now());
    new.confirmed_by := auth.uid();
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = old.status and new.status = 'mastered' then
    new.confirmed_at := old.confirmed_at;
    new.confirmed_by := old.confirmed_by;
  else
    new.confirmed_at := null;
    new.confirmed_by := null;
  end if;
  return new;
end;
$$;

do $$
begin
  perform set_config('dtt.confirming', '1', true);
  update public.user_learned_techniques l
     set confirmed_at = now(), confirmed_by = l.user_id
    from public.profiles p
   where p.id = l.user_id and p.role = 'admin' and l.status = 'mastered' and l.confirmed_at is null;
end $$;

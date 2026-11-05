-- =====================================================================
-- DTT Club — Слой 14: оценки партнёров по 7 критериям (1–5):
-- техника, скорость, сила, гибкость, стойка, болевые, удушающие.
-- Заменяет таблицу peer_ratings из layer13 (там были другие критерии;
-- на момент замены оценок в ней не было). Скрипт идемпотентный.
--
-- Правила:
--   • ученики оценивают друг друга (себя и тренера — нельзя);
--   • одна оценка от одного ученика другому, её можно изменить или удалить;
--   • кто поставил оценку, видят только сам автор и тренер;
--   • ученик видит свои средние только когда оценок 3+ (чтобы не вычислить автора).
-- =====================================================================

-- Старая версия таблицы (charisma_score и т.п.) — пересоздаём.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'peer_ratings' and column_name = 'charisma_score') then
    drop table public.peer_ratings cascade;
  end if;
end $$;
drop function if exists public.peer_rating_summary(uuid);

create table if not exists public.peer_ratings (
  rater_id         uuid     not null references public.profiles (id) on delete cascade,
  target_id        uuid     not null references public.profiles (id) on delete cascade,
  technique_score  smallint not null check (technique_score  between 1 and 5),
  speed_score      smallint not null check (speed_score      between 1 and 5),
  strength_score   smallint not null check (strength_score   between 1 and 5),
  flexibility_score smallint not null check (flexibility_score between 1 and 5),
  stance_score     smallint not null check (stance_score     between 1 and 5),  -- стойка
  armlock_score    smallint not null check (armlock_score    between 1 and 5),  -- болевые
  choke_score      smallint not null check (choke_score      between 1 and 5),  -- удушающие
  updated_at       timestamptz not null default now(),
  primary key (rater_id, target_id),
  check (rater_id <> target_id)
);
create index if not exists peer_ratings_target_idx on public.peer_ratings (target_id);

alter table public.peer_ratings enable row level security;
revoke all on public.peer_ratings from anon, authenticated;
grant select, insert, update, delete on public.peer_ratings to authenticated;

-- Тренера не оценивают; оценивает только ученик (не тренер).
create or replace function public.is_athlete(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = p_id and role = 'athlete');
$$;
revoke execute on function public.is_athlete(uuid) from public, anon;
grant execute on function public.is_athlete(uuid) to authenticated;

drop policy if exists "ratings: own given or coach read" on public.peer_ratings;
create policy "ratings: own given or coach read" on public.peer_ratings
  for select to authenticated using (rater_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "ratings: own write" on public.peer_ratings;
drop policy if exists "ratings: athlete rates athlete" on public.peer_ratings;
create policy "ratings: athlete rates athlete" on public.peer_ratings
  for all to authenticated
  using (rater_id = (select auth.uid()))
  with check (
    rater_id = (select auth.uid())
    and public.is_athlete(rater_id)
    and public.is_athlete(target_id)
  );


-- Средние оценки. Ученик — только свои (и только при 3+ оценках), тренер — любого.
create or replace function public.peer_rating_summary(p_target uuid default null)
returns table (
  ratings     integer,
  technique   numeric,
  speed       numeric,
  strength    numeric,
  flexibility numeric,
  stance      numeric,
  armlock     numeric,
  choke       numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target uuid := coalesce(p_target, auth.uid());
  v_n      integer;
begin
  if auth.uid() is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;
  if v_target <> auth.uid() and not public.is_admin() then
    raise exception 'Можно смотреть только свои оценки' using errcode = '42501';
  end if;

  select count(*) into v_n from public.peer_ratings where target_id = v_target;
  if v_n < 3 and not public.is_admin() then
    return query select v_n, null::numeric, null::numeric, null::numeric, null::numeric,
                        null::numeric, null::numeric, null::numeric;
    return;
  end if;

  return query
  select v_n,
         round(avg(technique_score), 1),   round(avg(speed_score), 1),
         round(avg(strength_score), 1),    round(avg(flexibility_score), 1),
         round(avg(stance_score), 1),      round(avg(armlock_score), 1),
         round(avg(choke_score), 1)
    from public.peer_ratings where target_id = v_target;
end;
$$;

revoke execute on function public.peer_rating_summary(uuid) from public, anon;
grant execute on function public.peer_rating_summary(uuid) to authenticated;

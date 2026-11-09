-- =====================================================================
-- DTT Club — Слой 39: оценки партнёров по 10-балльной шкале с сотыми (1.00–10.00)
-- и рейтинг клуба: топ бойцов MMA и топ борцов грэпплинга.
-- Выполнить ПОСЛЕ layer14 и layer18. Скрипт идемпотентный.
--
-- • Старые оценки 1–5 переводятся ×2 (5 → 10, 3 → 6).
-- • Рейтинг = средний балл по 7 боевым критериям (гигиена в рейтинг НЕ входит,
--   её среднее по-прежнему видит только сам ученик и тренер).
-- • В рейтинг попадают взрослые ученики с 3+ оценками; кто скрыл профиль —
--   не попадает (тренер видит всех). Кто кого оценил — по-прежнему не видно.
-- =====================================================================

do $$
declare c text;
begin
  -- 1. Снять старые проверки 1–5 и перевести столбцы в numeric(4,2), ×2.
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'peer_ratings' and column_name = 'technique_score') = 'smallint' then
    foreach c in array array['technique','speed','strength','flexibility','stance','armlock','choke','hygiene'] loop
      execute format('alter table public.peer_ratings drop constraint if exists peer_ratings_%s_score_check', c);
      execute format('alter table public.peer_ratings alter column %1$I type numeric(4,2) using %1$I * 2', c || '_score');
    end loop;
  end if;
  -- 2. Новые проверки 1–10 (гигиена может быть пустой).
  foreach c in array array['technique','speed','strength','flexibility','stance','armlock','choke'] loop
    execute format('alter table public.peer_ratings drop constraint if exists peer_ratings_%s_score_check', c);
    execute format('alter table public.peer_ratings add constraint peer_ratings_%1$s_score_check check (%1$s_score between 1 and 10)', c);
  end loop;
  alter table public.peer_ratings drop constraint if exists peer_ratings_hygiene_score_check;
  alter table public.peer_ratings add constraint peer_ratings_hygiene_score_check
    check (hygiene_score is null or hygiene_score between 1 and 10);
end $$;

-- Средние — теперь с сотыми (9.76). Права те же, что в слое 18.
create or replace function public.peer_rating_summary(p_target uuid default null)
returns table (
  ratings     integer,
  technique   numeric,
  speed       numeric,
  strength    numeric,
  flexibility numeric,
  stance      numeric,
  armlock     numeric,
  choke       numeric,
  hygiene     numeric
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
                        null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;

  return query
  select v_n,
         round(avg(technique_score), 2),   round(avg(speed_score), 2),
         round(avg(strength_score), 2),    round(avg(flexibility_score), 2),
         round(avg(stance_score), 2),      round(avg(armlock_score), 2),
         round(avg(choke_score), 2),       round(avg(hygiene_score), 2)
    from public.peer_ratings where target_id = v_target;
end;
$$;
revoke execute on function public.peer_rating_summary(uuid) from public, anon;
grant execute on function public.peer_rating_summary(uuid) to authenticated;

-- Рейтинг клуба по направлению ('mma' | 'grappling').
create or replace function public.peer_leaderboard(p_discipline text)
returns table (
  id         uuid,
  first_name text,
  last_name  text,
  avatar_url text,
  ratings    integer,
  score      numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.first_name, p.last_name, p.avatar_url, count(*)::int,
         round(avg((r.technique_score + r.speed_score + r.strength_score + r.flexibility_score
                    + r.stance_score + r.armlock_score + r.choke_score) / 7.0), 2)
    from public.peer_ratings r
    join public.profiles p on p.id = r.target_id
   where auth.uid() is not null
     and p.role = 'athlete'
     and p.parent_id is null
     and p.discipline = p_discipline
     and (not p.hide_profile or public.is_staff())
   group by p.id
  having count(*) >= 3
   order by 6 desc, 5 desc, p.last_name;
$$;
revoke execute on function public.peer_leaderboard(text) from public, anon;
grant execute on function public.peer_leaderboard(text) to authenticated;

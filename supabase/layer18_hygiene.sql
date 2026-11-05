-- =====================================================================
-- DTT Club — Слой 18: восьмой критерий оценки партнёров — «Гигиена».
-- Выполнить ПОСЛЕ layer14_peer_ratings.sql. Скрипт идемпотентный.
-- Анонимно, как и остальные: автор не виден, среднее — от 3 оценок.
-- У уже поставленных оценок пункт пустой (null) и в среднее не входит;
-- при следующем изменении оценки его нужно будет заполнить.
-- =====================================================================

alter table public.peer_ratings add column if not exists hygiene_score smallint
  check (hygiene_score is null or hygiene_score between 1 and 5);

drop function if exists public.peer_rating_summary(uuid);
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
         round(avg(technique_score), 1),   round(avg(speed_score), 1),
         round(avg(strength_score), 1),    round(avg(flexibility_score), 1),
         round(avg(stance_score), 1),      round(avg(armlock_score), 1),
         round(avg(choke_score), 1),       round(avg(hygiene_score), 1)
    from public.peer_ratings where target_id = v_target;
end;
$$;

revoke execute on function public.peer_rating_summary(uuid) from public, anon;
grant execute on function public.peer_rating_summary(uuid) to authenticated;

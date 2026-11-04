-- =====================================================================
-- DTT Club — Слой 5: направление спортсмена и ручной ранг от тренера.
-- Выполнить ПОСЛЕ schema.sql и layer4_crm.sql. Скрипт идемпотентный.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Новые колонки профиля
-- ---------------------------------------------------------------------
-- Направление: ранги есть только у грепплинга (grappling / both).
alter table public.profiles add column if not exists discipline text not null default 'grappling';
alter table public.profiles drop constraint if exists profiles_discipline_check;
alter table public.profiles add constraint profiles_discipline_check
  check (discipline in ('grappling', 'mma', 'both'));

-- Ранг, назначенный тренером вручную (1..5). NULL = автоматический по тренировкам.
alter table public.profiles add column if not exists rank_override smallint;
alter table public.profiles drop constraint if exists profiles_rank_override_check;
alter table public.profiles add constraint profiles_rank_override_check
  check (rank_override between 1 and 5);

-- Спортсмен эти колонки сам не меняет: права на update у него только на
-- first_name, last_name, avatar_url (см. schema.sql) — здесь ничего выдавать не нужно.


-- ---------------------------------------------------------------------
-- 2. Триггер регистрации: теперь сохраняет и направление
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discipline text := coalesce(nullif(new.raw_user_meta_data ->> 'discipline', ''), 'grappling');
begin
  if v_discipline not in ('grappling', 'mma', 'both') then
    v_discipline := 'grappling';
  end if;

  insert into public.profiles (id, first_name, last_name, discipline)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    v_discipline
  );
  insert into public.profile_contacts (id, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'phone', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. Тренер меняет направление и ранг спортсмена
--    p_rank_override = NULL → вернуть автоматический ранг.
-- ---------------------------------------------------------------------
create or replace function public.set_athlete_settings(
  p_athlete       uuid,
  p_discipline    text,
  p_rank_override integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Только тренер может менять ранг и направление' using errcode = '42501';
  end if;

  update public.profiles
     set discipline    = p_discipline,
         rank_override = p_rank_override
   where id = p_athlete;

  if not found then
    raise exception 'Спортсмен не найден';
  end if;
end;
$$;

revoke execute on function public.set_athlete_settings(uuid, text, integer) from public, anon;
grant  execute on function public.set_athlete_settings(uuid, text, integer) to authenticated;

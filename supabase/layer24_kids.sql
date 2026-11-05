-- =====================================================================
-- DTT Club — Слой 24: детские аккаунты. Родитель добавляет ребёнка из своего кабинета,
-- ребёнок входит сам по логину «телефон родителя-номер» (например 37127167013-1) и паролю.
-- Выполнить ПОСЛЕ layer23_mma_kids.sql. Скрипт идемпотентный.
--
-- Как связываются: логин ребёнка = <телефон родителя>-<1..99>. При создании аккаунта
-- триггер находит родителя по телефону и записывает profiles.parent_id.
-- Логин без существующего родителя создать нельзя.
-- Родитель видит детей в кабинете (профили и так видны всем вошедшим) и может отвязать.
-- =====================================================================

alter table public.profiles
  add column if not exists parent_id uuid references public.profiles (id) on delete set null;
create index if not exists profiles_parent_idx on public.profiles (parent_id);

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

  -- Детский логин «<телефон родителя>-<номер>»: родитель должен уже быть в клубе.
  if v_login ~ '^[0-9]{8,15}-[0-9]{1,2}$' then
    select pc.id into v_parent
      from public.profile_contacts pc
     where pc.phone = split_part(v_login, '-', 1)
     limit 1;
    if v_parent is null then
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
  insert into public.profile_contacts (id, phone)
  values (
    new.id,
    -- у ребёнка «телефон» = его логин (телефон родителя-номер): тренер видит, кому звонить
    case when v_parent is not null then v_login
         else coalesce(new.raw_user_meta_data ->> 'phone', v_login) end
  );
  return new;
end;
$$;

-- Родитель отвязывает ребёнка (например, по ошибке привязался чужой аккаунт).
create or replace function public.unlink_child(p_child uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set parent_id = null
   where id = p_child and parent_id = (select auth.uid());
$$;
revoke execute on function public.unlink_child(uuid) from public, anon;
grant execute on function public.unlink_child(uuid) to authenticated;

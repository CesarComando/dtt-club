-- =====================================================================
-- DTT Club — Слой 27: закрытие дыр, найденных при проверке безопасности (ноябрь 2026).
-- Выполнить ПОСЛЕ layer26_custom_amount.sql. Скрипт идемпотентный.
--
-- 1. Телефон в profile_contacts больше нельзя менять самому. Раньше ученик мог вписать
--    чужой номер — и тогда ребёнок, которого добавляет владелец номера, привязывался бы
--    к нему (а он мог бы сменить ребёнку пароль). Приложение телефон не меняет — только читает.
-- 2. При регистрации телефон берётся из логина (email <цифры>@dtt.local), а не из данных,
--    которые присылает браузер (metadata.phone) — иначе можно было «примерить» чужой номер
--    и привязаться к записи ученика из списка клуба с его историей оплат.
-- 3. Родителя ребёнка ищем по его настоящему логину (auth.users), а не по таблице контактов.
-- =====================================================================

drop policy if exists "contacts: user can update own" on public.profile_contacts;
revoke update on public.profile_contacts from authenticated;

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

  -- Детский логин «<телефон родителя>-<номер>»: родитель — владелец логина <телефон>@dtt.local.
  if v_login ~ '^[0-9]{8,15}-[0-9]{1,2}$' then
    select p.id into v_parent
      from auth.users u
      join public.profiles p on p.id = u.id
     where u.email = split_part(v_login, '-', 1) || '@dtt.local'
       and p.parent_id is null           -- ребёнок не может быть родителем
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
  -- Телефон = логин (у ребёнка — «телефон родителя-номер»), не из metadata.
  insert into public.profile_contacts (id, phone) values (new.id, v_login);
  return new;
end;
$$;

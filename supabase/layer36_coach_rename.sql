-- =====================================================================
-- DTT Club — Слой 36: тренер исправляет имя и фамилию (опечатки при регистрации).
-- Выполнить в Supabase SQL Editor. Скрипт идемпотентный.
--
-- coach_rename(p_member, p_profile, p_first, p_last) — только тренер (admin).
-- Меняет имя в записи ученика клуба и/или в аккаунте приложения.
-- Свой профиль ученик по-прежнему правит сам; чужой — только тренер через эту функцию.
-- =====================================================================

create or replace function public.coach_rename(
  p_member  bigint,
  p_profile uuid,
  p_first   text,
  p_last    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first text := nullif(btrim(p_first), '');
  v_last  text := nullif(btrim(p_last), '');
begin
  if not public.is_admin() then
    raise exception 'Только для тренера' using errcode = '42501';
  end if;
  if v_first is null or v_last is null then
    raise exception 'Введите имя и фамилию';
  end if;
  if length(v_first) > 60 or length(v_last) > 60 then
    raise exception 'Слишком длинное имя';
  end if;
  if p_member is not null then
    update public.club_members set first_name = v_first, last_name = v_last where id = p_member;
  end if;
  if p_profile is not null then
    update public.profiles set first_name = v_first, last_name = v_last where id = p_profile;
  end if;
end;
$$;
revoke execute on function public.coach_rename(bigint, uuid, text, text) from public, anon;
grant execute on function public.coach_rename(bigint, uuid, text, text) to authenticated;

-- Разовое исправление: Gsigulis → Gaigulis (Марис и его отец Дайрис).
update public.profiles     set last_name = 'Gaigulis' where last_name = 'Gsigulis';
update public.club_members set last_name = 'Gaigulis' where last_name = 'Gsigulis';

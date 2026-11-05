-- =====================================================================
-- DTT Club — Слой 16: тренер подтверждает новых учеников (зелёная галочка).
-- Выполнить ПОСЛЕ layer11_member_matching.sql. Скрипт идемпотентный.
--
-- profiles.approved_at — когда тренер подтвердил аккаунт (null = ждёт).
-- Сам ученик поменять не может (update-права на колонку не выдаются).
-- Связка с учеником клуба (вручную или автоматически по телефону) = подтверждение.
-- Неподтверждённый аккаунт работает как обычно — это отметка для тренера и ученика.
-- =====================================================================

alter table public.profiles add column if not exists approved_at timestamptz;
comment on column public.profiles.approved_at is 'Тренер подтвердил ученика (зелёная галочка). Меняет только тренер.';

-- Тренер и уже связанные с учениками клуба — подтверждены.
update public.profiles set approved_at = now()
 where approved_at is null
   and (role = 'admin' or id in (select profile_id from public.club_members where profile_id is not null));


-- Тренер: подтвердить / снять подтверждение.
create or replace function public.approve_athlete(p_athlete uuid, p_approved boolean default true)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Подтверждает только тренер' using errcode = '42501';
  end if;
  update public.profiles
     set approved_at = case when p_approved then coalesce(approved_at, now()) end
   where id = p_athlete
  returning approved_at into v_at;
  if not found then
    raise exception 'Ученик не найден';
  end if;
  return v_at;
end;
$$;
revoke execute on function public.approve_athlete(uuid, boolean) from public, anon;
grant execute on function public.approve_athlete(uuid, boolean) to authenticated;


-- Связка с учеником клуба подтверждает аккаунт.
create or replace function public.link_member_internal(p_member bigint, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank smallint;
  v_disc text;
begin
  update public.club_members set profile_id = p_profile where id = p_member
  returning rank_override, discipline into v_rank, v_disc;
  if p_profile is not null and found then
    update public.profiles
       set rank_override = coalesce(rank_override, v_rank),
           discipline    = coalesce(v_disc, discipline),
           approved_at   = coalesce(approved_at, now())
     where id = p_profile;
  end if;
end;
$$;
revoke execute on function public.link_member_internal(bigint, uuid) from public, anon, authenticated;

-- =====================================================================
-- DTT Club — Слой 11: связка учеников клуба с аккаунтами по телефону/имени.
-- Выполнить ПОСЛЕ layer10_members.sql. Скрипт идемпотентный.
-- Данные (телефоны, имена) сюда не кладём — только схему.
-- =====================================================================

-- Телефон (только цифры, 371XXXXXXXX) и другие написания имени
-- (кириллица, ник из WhatsApp-группы) — по ним ищем совпадения.
alter table public.club_members add column if not exists phone text;
alter table public.club_members add column if not exists aliases text[] not null default '{}';
create unique index if not exists club_members_phone_uq on public.club_members (phone) where phone is not null;

-- Контакты из WhatsApp-группы, которые пока не удалось сопоставить с учеником.
create table if not exists public.club_contacts (
  id           bigint generated always as identity primary key,
  display_name text not null,                 -- как подписан в группе
  phone        text unique,                   -- только цифры
  member_id    bigint references public.club_members (id) on delete set null,
  source       text not null default 'whatsapp',
  created_at   timestamptz not null default now()
);
alter table public.club_contacts enable row level security;
revoke all on public.club_contacts from anon, authenticated;
grant select, insert, update, delete on public.club_contacts to authenticated;
drop policy if exists "contacts list: coach manages" on public.club_contacts;
create policy "contacts list: coach manages" on public.club_contacts
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));


-- Связать без проверки роли (вызывается из триггера и из link_member).
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
           discipline    = coalesce(v_disc, discipline)
     where id = p_profile;
  end if;
end;
$$;
revoke execute on function public.link_member_internal(bigint, uuid) from public, anon, authenticated;

create or replace function public.link_member(p_member bigint, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Только тренер связывает учеников' using errcode = '42501';
  end if;
  if not exists (select 1 from public.club_members where id = p_member) then
    raise exception 'Ученик не найден';
  end if;
  perform public.link_member_internal(p_member, p_profile);
end;
$$;


-- Автосвязка: новый аккаунт с телефоном, который уже есть у ученика клуба
-- (или у контакта группы, сопоставленного с учеником).
create or replace function public.auto_link_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member bigint;
begin
  select id into v_member from public.club_members
   where phone = new.phone and profile_id is null limit 1;
  if v_member is null then
    select c.member_id into v_member
      from public.club_contacts c
      join public.club_members m on m.id = c.member_id
     where c.phone = new.phone and m.profile_id is null limit 1;
  end if;
  if v_member is not null then
    perform public.link_member_internal(v_member, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists profile_contacts_auto_link on public.profile_contacts;
create trigger profile_contacts_auto_link
  after insert on public.profile_contacts
  for each row execute function public.auto_link_member();

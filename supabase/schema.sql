-- =====================================================================
-- DTT Club — Слой 3: профили, RLS, триггер регистрации, бакет для селфи.
-- Выполнить целиком в Supabase → SQL Editor → New query → Run.
-- Скрипт идемпотентный: его можно запускать повторно.
-- ПОРЯДОК: schema.sql → layer4_crm.sql → layer5_ranks.sql
-- (если перезапускаете schema.sql — перезапустите после него и layer5,
--  иначе триггер регистрации перестанет сохранять направление).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Таблица profiles (1:1 с auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  first_name      text        not null,
  last_name       text        not null,
  avatar_url     text,                                 -- путь в бакете avatars: <user_id>/selfie.jpg
  trainings_count integer     not null default 0 check (trainings_count >= 0),
  role            text        not null default 'athlete' check (role in ('athlete', 'admin')),
  created_at      timestamptz not null default now()
);

-- Дата начала занятий в клубе (может быть раньше регистрации в приложении).
-- Если пусто — стаж считается от created_at. Заполняется через SQL / позже из CRM.
alter table public.profiles add column if not exists training_since date;

comment on column public.profiles.trainings_count is 'Меняет только тренер (CRM посещаемости). Ранг считается из этого числа.';
comment on column public.profiles.role is 'athlete | admin. Меняется только вручную через SQL/Dashboard.';

-- Телефоны — в отдельной таблице: их видит только сам спортсмен и тренер.
create table if not exists public.profile_contacts (
  id    uuid primary key references public.profiles (id) on delete cascade,
  phone text not null unique                            -- только цифры, напр. 37120000000
);

-- true, если текущий пользователь — тренер (role = 'admin').
-- security definer: проверка не упирается в RLS самих таблиц.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;


-- ---------------------------------------------------------------------
-- 2. RLS: читать могут все вошедшие, менять — только свой профиль
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles: authenticated can read all" on public.profiles;
create policy "profiles: authenticated can read all"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles: user can update own" on public.profiles;
create policy "profiles: user can update own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- INSERT делает только триггер ниже, DELETE — каскадом при удалении пользователя.
-- Поэтому политик на insert/delete для клиентов нет.

-- Защита геймификации: спортсмен может править свои данные,
-- но НЕ trainings_count и НЕ role (иначе можно накрутить себе ранг).
revoke update on public.profiles from anon, authenticated;
grant  update (first_name, last_name, avatar_url) on public.profiles to authenticated;

-- Явные права (не полагаемся на «Automatically expose new tables»).
revoke all on public.profiles, public.profile_contacts from anon;
grant select on public.profiles to authenticated;
revoke insert, delete, truncate on public.profiles, public.profile_contacts from authenticated;
revoke update on public.profile_contacts from authenticated;
grant select, update (phone) on public.profile_contacts to authenticated;

-- Телефоны: читать — только свой или тренер; менять — только свой.
alter table public.profile_contacts enable row level security;

drop policy if exists "contacts: own or coach can read" on public.profile_contacts;
create policy "contacts: own or coach can read"
  on public.profile_contacts for select
  to authenticated
  using ((select auth.uid()) = id or (select public.is_admin()));

drop policy if exists "contacts: user can update own" on public.profile_contacts;
create policy "contacts: user can update own"
  on public.profile_contacts for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);


-- ---------------------------------------------------------------------
-- 3. Триггер: при auth.signUp() автоматически создаём профиль
--    Данные берутся из options.data (raw_user_meta_data).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', '')
  );
  insert into public.profile_contacts (id, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'phone', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 4. Storage: приватный бакет avatars для селфи
--    Приватный — потому что в клубе есть дети (Детское MMA):
--    фото видят только вошедшие пользователи, по временной ссылке.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Смотреть фото могут все вошедшие (тренеру нужно узнавать учеников).
drop policy if exists "avatars: authenticated can read" on storage.objects;
create policy "avatars: authenticated can read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars');

-- Загружать/заменять/удалять — только в свою папку <user_id>/...
drop policy if exists "avatars: user can upload own" on storage.objects;
create policy "avatars: user can upload own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars: user can update own" on storage.objects;
create policy "avatars: user can update own"
  on storage.objects for update
  to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars: user can delete own" on storage.objects;
create policy "avatars: user can delete own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);


-- ---------------------------------------------------------------------
-- 5. (Потом, вручную) Назначить тренера админом — после его регистрации:
--    update public.profiles set role = 'admin'
--    where id = (select id from public.profile_contacts where phone = '371XXXXXXXX');
-- ---------------------------------------------------------------------

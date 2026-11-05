-- =====================================================================
-- DTT Club — Слой 19: галерея (фото и видео с тренировок и соревнований).
-- Выполнить ПОСЛЕ schema.sql. Скрипт идемпотентный.
--
-- • Добавлять может любой вошедший; в общей галерее файл появляется
--   после одобрения тренером (status = 'approved'). Тренер публикует сразу.
-- • Смотрят только вошедшие (бакет приватный, ссылки временные) —
--   в клубе есть дети.
-- • Свои файлы автор видит сразу (с пометкой «на проверке») и может удалить.
-- • Файлы лежат в бакете gallery в папке <user_id>/… — удаление аккаунта
--   (Edge Function delete-account) стирает и их.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', false, 52428800,   -- 50 МБ (видео)
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.gallery_items (
  id          bigint generated always as identity primary key,
  author_id   uuid        not null default auth.uid() references public.profiles (id) on delete cascade,
  path        text        not null unique,                 -- путь в бакете gallery: <author_id>/<uuid>.<ext>
  kind        text        not null check (kind in ('photo', 'video')),
  album       text        not null default 'training' check (album in ('training', 'competition', 'other')),
  caption     text        not null default '' check (length(caption) <= 300),
  status      text        not null default 'pending' check (status in ('pending', 'approved')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  check (split_part(path, '/', 1) = author_id::text)
);
create index if not exists gallery_items_feed_idx on public.gallery_items (status, created_at desc);

alter table public.gallery_items enable row level security;
revoke all on public.gallery_items from anon, authenticated;
grant select, insert, delete on public.gallery_items to authenticated;
grant update (status, caption, album, approved_at) on public.gallery_items to authenticated;  -- пропустит только политика тренера

drop policy if exists "gallery: read approved, own or coach" on public.gallery_items;
create policy "gallery: read approved, own or coach" on public.gallery_items
  for select to authenticated
  using (status = 'approved' or author_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "gallery: add own" on public.gallery_items;
create policy "gallery: add own" on public.gallery_items
  for insert to authenticated
  with check (author_id = (select auth.uid()));

drop policy if exists "gallery: coach edits" on public.gallery_items;
create policy "gallery: coach edits" on public.gallery_items
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "gallery: delete own or coach" on public.gallery_items;
create policy "gallery: delete own or coach" on public.gallery_items
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- Статус при добавлении ставит сервер: ученик — «на проверке», тренер — сразу в галерею.
create or replace function public.gallery_items_set_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_admin() then
    new.status := 'approved';
    new.approved_at := now();
  else
    new.status := 'pending';
    new.approved_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists gallery_items_set_status on public.gallery_items;
create trigger gallery_items_set_status
  before insert on public.gallery_items
  for each row execute function public.gallery_items_set_status();


-- ---------------------------------------------------------------------
-- Storage: загрузка — только в свою папку; смотреть — одобренное, своё,
-- или тренеру всё; удалять — своё или тренер.
-- ---------------------------------------------------------------------
drop policy if exists "gallery files: upload own" on storage.objects;
create policy "gallery files: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gallery' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "gallery files: read" on storage.objects;
create policy "gallery files: read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'gallery' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_admin())
      or exists (select 1 from public.gallery_items g where g.path = name and g.status = 'approved')
    )
  );

drop policy if exists "gallery files: delete own or coach" on storage.objects;
create policy "gallery files: delete own or coach" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'gallery'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

-- =====================================================================
-- DTT Club — Слой 28: «Статьи» — новости клуба, переводы, интервью.
-- Выполнить ПОСЛЕ layer27_security.sql. Скрипт идемпотентный.
--
-- • Пишет и публикует только тренер (admin). Черновики видит только он.
-- • У статьи флаг members_only: «только ученикам» (по умолчанию) или «всем»,
--   включая гостей сайта. Переводы чужих интервью/речей лучше держать
--   «только ученикам» и всегда указывать источник (source_url).
-- • Обложки — бакет articles (публичный: статьи могут быть открыты гостям).
-- =====================================================================

create table if not exists public.articles (
  id           bigint generated always as identity primary key,
  title        text        not null check (length(title) between 1 and 200),
  category     text        not null default 'news'
               check (category in ('news', 'translation', 'interview', 'article')),
  lead         text        not null default '' check (length(lead) <= 500),       -- короткое описание для списка
  body         text        not null default '' check (length(body) <= 100000),
  source_title text        not null default '' check (length(source_title) <= 200), -- напр. «John Danaher, BJJ Fanatics»
  source_url   text        check (source_url is null or source_url ~* '^https?://'),
  cover_path   text,                                                               -- путь в бакете articles
  members_only boolean     not null default true,
  published    boolean     not null default false,
  author_id    uuid        default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  published_at timestamptz,
  updated_at   timestamptz not null default now()
);
create index if not exists articles_feed_idx on public.articles (published, published_at desc);

alter table public.articles enable row level security;
revoke all on public.articles from anon, authenticated;
grant select on public.articles to anon, authenticated;
grant insert, update, delete on public.articles to authenticated;   -- пропустит только политика тренера

drop policy if exists "articles: read published" on public.articles;
create policy "articles: read published" on public.articles
  for select to anon, authenticated
  using (
    (published and (not members_only or (select auth.uid()) is not null))
    or (select public.is_admin())
  );

drop policy if exists "articles: coach writes" on public.articles;
create policy "articles: coach writes" on public.articles
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Дата публикации и правки ставится сама.
create or replace function public.articles_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.published and (tg_op = 'INSERT' or not old.published) then
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;
revoke execute on function public.articles_touch() from anon, authenticated;
drop trigger if exists articles_touch on public.articles;
create trigger articles_touch
  before insert or update on public.articles
  for each row execute function public.articles_touch();


-- Обложки статей: читать — всем, загружать/удалять — только тренеру.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('articles', 'articles', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "articles files: coach uploads" on storage.objects;
create policy "articles files: coach uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'articles' and (select public.is_admin()));

drop policy if exists "articles files: coach deletes" on storage.objects;
create policy "articles files: coach deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'articles' and (select public.is_admin()));

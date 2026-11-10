-- =====================================================================
-- DTT Club — Слой 41: мои соревнования.
-- Ученик сам записывает турнир: когда, где, какой, направление, категория,
-- занятое место и бои (соперник, результат, способ, приём, время).
-- Видят сам ученик и главный тренер; тренер может и записать за ученика.
-- Скрипт идемпотентный.
-- =====================================================================

create table if not exists public.competitions (
  id          bigint generated always as identity primary key,
  user_id     uuid   not null default auth.uid() references public.profiles (id) on delete cascade,
  date        date   not null,
  title       text   not null check (char_length(title) between 2 and 160),
  city        text   check (char_length(city) <= 120),
  discipline  text   not null default 'grappling'
              check (discipline in ('grappling', 'bjj', 'mma', 'k1', 'kickboxing', 'pankration', 'wrestling', 'other')),
  category    text   check (char_length(category) <= 120),          -- вес / возраст / пояс
  place       smallint check (place between 1 and 64),              -- null — без места
  fights      jsonb  not null default '[]' check (jsonb_typeof(fights) = 'array'),
  notes       text   check (char_length(notes) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists competitions_user_date on public.competitions (user_id, date desc);

alter table public.competitions enable row level security;
revoke all on public.competitions from anon;
grant select, insert, update, delete on public.competitions to authenticated;

drop policy if exists "competitions: own or head coach" on public.competitions;
create policy "competitions: own or head coach" on public.competitions for all to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

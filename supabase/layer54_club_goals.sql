-- =====================================================================
-- DTT Club — Слой 54: цель клуба на месяц.
-- Одна цель на календарный месяц для всего клуба (видна тренеру и на телефоне, и на компьютере).
-- Показатель цели — среднее число разных участников в неделю (считается из attendance в приложении
-- через coach_stats). Здесь хранится только сама цель и отмеченные шаги.
-- Читать и менять может только тренер (is_admin). Скрипт идемпотентный.
-- =====================================================================

create table if not exists public.club_goals (
  month       date        primary key check (month = date_trunc('month', month)::date),
  title       text        not null default '' check (char_length(title) <= 140),
  target      integer     not null check (target between 1 and 10000),
  start_value numeric     check (start_value >= 0),          -- показатель в момент постановки цели
  done        text[]      not null default '{}',              -- выполненные шаги (id)
  updated_at  timestamptz not null default now(),
  updated_by  uuid        default auth.uid() references public.profiles (id) on delete set null
);
comment on table public.club_goals is 'Цель клуба на месяц (слой 54). Одна строка на месяц.';

alter table public.club_goals enable row level security;
revoke all on public.club_goals from anon;
grant select, insert, update, delete on public.club_goals to authenticated;

drop policy if exists "club goals: coach only" on public.club_goals;
create policy "club goals: coach only" on public.club_goals
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create or replace function public.club_goals_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists club_goals_touch on public.club_goals;
create trigger club_goals_touch before insert or update on public.club_goals
  for each row execute function public.club_goals_touch();

-- =====================================================================
-- DTT Club — Слой 10: список учеников клуба (в т.ч. без аккаунта) и
-- история их оплат вне приложения (банковские переводы, наличные).
-- Выполнить ПОСЛЕ layer9_checkin_debts.sql. Скрипт идемпотентный.
--
-- Сами данные учеников сюда НЕ кладём (репозиторий может быть публичным) —
-- они вносятся отдельно в Supabase.
-- Когда ученик регистрируется, тренер связывает запись с аккаунтом
-- (link_member) — история оплат становится видна в его кабинете.
-- =====================================================================

create table if not exists public.club_members (
  id            bigint generated always as identity primary key,
  first_name    text        not null,
  last_name     text        not null,
  discipline    text        check (discipline in ('grappling', 'mma', 'both')), -- null = по ситуации / не знаем
  parent_name   text,                       -- кто платит за ребёнка
  status        text        not null default 'regular'
                check (status in ('regular', 'occasional', 'one_time', 'left')),
  notes         text,                       -- «скидка 3 €», «меценат», «пакет 5 тренировок»
  rank_override smallint    check (rank_override between 1 and 5),  -- перенесётся в профиль при связке
  profile_id    uuid        unique references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists public.member_payments (
  id          bigint generated always as identity primary key,
  member_id   bigint        not null references public.club_members (id) on delete cascade,
  paid_on     date          not null,
  amount_cents integer      not null check (amount_cents > 0),
  kind        text          not null default 'training'
              check (kind in ('training', 'membership', 'pack', 'individual', 'uniform', 'donation', 'other')),
  method      text          not null default 'bank' check (method in ('bank', 'cash')),
  payer_name  text,                         -- как в банковской выписке
  description text,                         -- назначение платежа
  created_at  timestamptz   not null default now(),
  unique (member_id, paid_on, amount_cents, description)   -- повторный импорт не задвоит
);
create index if not exists member_payments_member_idx on public.member_payments (member_id, paid_on desc);

alter table public.club_members    enable row level security;
alter table public.member_payments enable row level security;
revoke all on public.club_members, public.member_payments from anon, authenticated;
grant select, insert, update, delete on public.club_members, public.member_payments to authenticated;

-- Тренер — всё; ученик — только свою связанную запись и её оплаты.
drop policy if exists "members: coach manages" on public.club_members;
create policy "members: coach manages" on public.club_members
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "members: own read" on public.club_members;
create policy "members: own read" on public.club_members
  for select to authenticated using (profile_id = (select auth.uid()));

drop policy if exists "member payments: coach manages" on public.member_payments;
create policy "member payments: coach manages" on public.member_payments
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "member payments: own read" on public.member_payments;
create policy "member payments: own read" on public.member_payments
  for select to authenticated
  using (exists (select 1 from public.club_members m
                  where m.id = member_id and m.profile_id = (select auth.uid())));


-- Связать запись ученика с аккаунтом (null — отвязать).
create or replace function public.link_member(p_member bigint, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank smallint;
  v_disc text;
begin
  if not public.is_admin() then
    raise exception 'Только тренер связывает учеников' using errcode = '42501';
  end if;

  update public.club_members set profile_id = p_profile where id = p_member
  returning rank_override, discipline into v_rank, v_disc;
  if not found then
    raise exception 'Ученик не найден';
  end if;

  -- Ранг и направление из списка клуба переносим в профиль, если там пусто/по умолчанию.
  if p_profile is not null then
    update public.profiles
       set rank_override = coalesce(rank_override, v_rank),
           discipline    = coalesce(v_disc, discipline)
     where id = p_profile;
  end if;
end;
$$;

revoke execute on function public.link_member(bigint, uuid) from public, anon;
grant  execute on function public.link_member(bigint, uuid) to authenticated;

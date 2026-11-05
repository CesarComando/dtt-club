-- =====================================================================
-- DTT Club — Слой 22: бюджет клуба (только главный тренер, role = 'admin').
-- Выполнить ПОСЛЕ layer21_hardening.sql. Скрипт идемпотентный.
--
-- Расходы вносит только тренер: аренда, электричество, вода, отопление, налоги,
-- бухгалтер, инвентарь, прочее. Доходы считаются сами:
--   • member_payments — переводы и наличные из списка клуба (оба банковских счёта);
--   • payments        — оплаты в приложении (карта Stripe и наличные), status = 'paid'.
-- Помощник тренера (role = 'coach') и ученики бюджет не видят.
-- Сами суммы сюда НЕ кладём (репозиторий может быть публичным) — они вносятся в Supabase.
-- =====================================================================

create table if not exists public.club_expenses (
  id           bigint generated always as identity primary key,
  spent_on     date        not null,
  category     text        not null
               check (category in ('rent', 'electricity', 'water', 'heating', 'taxes', 'accountant', 'inventory', 'other')),
  amount_cents integer     not null check (amount_cents > 0),
  note         text,
  created_at   timestamptz not null default now(),
  unique (spent_on, category, amount_cents, note)   -- повторный импорт не задвоит
);
-- Отопление (в счетах SANO D за зиму) — отдельная статья; для уже созданной таблицы обновляем проверку.
alter table public.club_expenses drop constraint if exists club_expenses_category_check;
alter table public.club_expenses add constraint club_expenses_category_check
  check (category in ('rent', 'electricity', 'water', 'heating', 'taxes', 'accountant', 'inventory', 'other'));
create index if not exists club_expenses_spent_idx on public.club_expenses (spent_on desc);

alter table public.club_expenses enable row level security;
revoke all on public.club_expenses from anon, authenticated;
grant select, insert, update, delete on public.club_expenses to authenticated;

drop policy if exists "expenses: head coach only" on public.club_expenses;
create policy "expenses: head coach only" on public.club_expenses
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));


-- Сводка по месяцам: доходы (банк/наличные из списка клуба + приложение) и расходы по категориям.
create or replace function public.budget_overview()
returns table (
  month          date,
  income_bank    integer,   -- member_payments (переводы, наличные вне приложения)
  income_app     integer,   -- payments (карта, наличные через приложение)
  expenses       integer,
  by_category    jsonb      -- {"rent": 6000, "taxes": 1589, …}
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Бюджет видит только главный тренер' using errcode = '42501';
  end if;

  return query
  with months as (
    select date_trunc('month', paid_on)::date m from public.member_payments
    union select date_trunc('month', created_at at time zone 'Europe/Riga')::date from public.payments where status = 'paid'
    union select date_trunc('month', spent_on)::date from public.club_expenses
  ),
  mp as (select date_trunc('month', paid_on)::date m, sum(amount_cents)::int s from public.member_payments group by 1),
  ap as (select date_trunc('month', created_at at time zone 'Europe/Riga')::date m, sum(amount_cents)::int s
           from public.payments where status = 'paid' group by 1),
  ex as (select date_trunc('month', spent_on)::date m, category, sum(amount_cents)::int s
           from public.club_expenses group by 1, 2)
  select months.m,
         coalesce(mp.s, 0),
         coalesce(ap.s, 0),
         coalesce((select sum(ex.s)::int from ex where ex.m = months.m), 0),
         coalesce((select jsonb_object_agg(ex.category, ex.s) from ex where ex.m = months.m), '{}'::jsonb)
    from months
    left join mp on mp.m = months.m
    left join ap on ap.m = months.m
   order by months.m desc;
end;
$$;

revoke execute on function public.budget_overview() from public, anon;
grant execute on function public.budget_overview() to authenticated;

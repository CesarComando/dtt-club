-- =====================================================================
-- DTT Club — Слой 7: оплата через Stripe (каталог, подписки, платежи).
-- Выполнить ПОСЛЕ layer6_future.sql. Скрипт идемпотентный.
--
-- Принципы:
--  * Каталог товаров — в таблице payment_products, а не в коде. Новый товар
--    (например, мерч GERA) = новая строка; товар и цена в Stripe создадутся
--    сами при первой покупке (Edge Function create-checkout).
--  * Статус оплаты меняет ТОЛЬКО сервер: Edge Function stripe-webhook
--    (ключ service_role, обходит RLS). У клиентов прав на запись нет.
--  * Ученик видит свои подписки и платежи, тренер — все.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Каталог товаров
-- ---------------------------------------------------------------------
create table if not exists public.payment_products (
  id                text primary key,                 -- код товара: 'mma_monthly', 'gera_tshirt_m' …
  kind              text        not null check (kind in ('membership', 'single', 'support', 'merch')),
  discipline        text        check (discipline in ('mma', 'grappling')), -- для абонементов и разовых
  title             text        not null,
  description       text,
  amount_cents      integer     not null check (amount_cents > 0),         -- цена с НДС (inclusive)
  currency          text        not null default 'eur',
  billing_interval  text        check (billing_interval in ('month', 'year')), -- NULL = разовая оплата
  tax_code          text,                             -- Stripe tax code (txcd_…); NULL = код по умолчанию из настроек Stripe Tax
  active            boolean     not null default true,
  sort              integer     not null default 100,
  stripe_product_id text,                             -- заполняет сервер
  stripe_price_id   text unique,                      -- заполняет сервер
  created_at        timestamptz not null default now()
);

comment on table public.payment_products is
  'Каталог оплат. Чтобы поменять цену: выключить старую строку (active=false) и добавить новую с другим id — цены в Stripe неизменяемы.';

insert into public.payment_products (id, kind, discipline, title, description, amount_cents, billing_interval, sort) values
  ('mma_monthly',       'membership', 'mma',       'Абонемент MMA / K1',        'Безлимит на месяц, автопродление', 4500, 'month', 10),
  ('grappling_monthly', 'membership', 'grappling', 'Абонемент Grappling no-gi', 'Безлимит на месяц, автопродление', 4000, 'month', 20),
  ('mma_single',        'single',     'mma',       'Разовая тренировка MMA / K1', null,                              600, null,   30),
  ('grappling_single',  'single',     'grappling', 'Разовая тренировка Grappling', null,                             500, null,   40),
  ('support_monthly',   'support',    null,        'Поддержать клуб',           'Ежемесячная поддержка клуба',       500, 'month', 90)
on conflict (id) do nothing;

alter table public.payment_products enable row level security;
revoke all on public.payment_products from anon, authenticated;
grant select on public.payment_products to authenticated;

drop policy if exists "products: authenticated read active" on public.payment_products;
create policy "products: authenticated read active"
  on public.payment_products for select
  to authenticated
  using (active or (select public.is_admin()));


-- ---------------------------------------------------------------------
-- 2. Связь пользователь ↔ Stripe Customer (только для сервера)
-- ---------------------------------------------------------------------
create table if not exists public.stripe_customers (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  customer_id text not null unique,
  created_at  timestamptz not null default now()
);
alter table public.stripe_customers enable row level security;
revoke all on public.stripe_customers from anon, authenticated;
-- политик нет: клиенты таблицу не видят, работает только service_role.


-- ---------------------------------------------------------------------
-- 3. Подписки (абонементы и «Поддержать клуб»)
-- ---------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                   text primary key,             -- Stripe subscription id (sub_…)
  user_id              uuid        not null references public.profiles (id) on delete cascade,
  product_id           text        references public.payment_products (id),
  status               text        not null,         -- active | trialing | past_due | canceled | unpaid | incomplete …
  current_period_end   timestamptz,                  -- «оплачено до»
  cancel_at_period_end boolean     not null default false,
  updated_at           timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id);

alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

drop policy if exists "subscriptions: own or coach can read" on public.subscriptions;
create policy "subscriptions: own or coach can read"
  on public.subscriptions for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));


-- ---------------------------------------------------------------------
-- 4. Платежи (разовые и каждое списание по подписке)
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id                  bigint generated always as identity primary key,
  user_id             uuid        not null references public.profiles (id) on delete cascade,
  product_id          text        references public.payment_products (id),
  subscription_id     text,
  stripe_session_id   text unique,                   -- разовая оплата через Checkout (cs_…)
  stripe_invoice_id   text unique,                   -- списание по подписке (in_…)
  stripe_payment_intent text,
  amount_cents        integer     not null,
  currency            text        not null default 'eur',
  status              text        not null default 'paid' check (status in ('paid', 'failed', 'refunded')),
  created_at          timestamptz not null default now()
);
create index if not exists payments_user_created_idx on public.payments (user_id, created_at desc);
create index if not exists payments_payment_intent_idx on public.payments (stripe_payment_intent);

alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

drop policy if exists "payments: own or coach can read" on public.payments;
create policy "payments: own or coach can read"
  on public.payments for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));


-- ---------------------------------------------------------------------
-- 5. Журнал обработанных событий Stripe (защита от повторной доставки)
-- ---------------------------------------------------------------------
create table if not exists public.stripe_events (
  id          text primary key,                      -- evt_…
  type        text        not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. profiles.is_sponsor = есть живая подписка «Поддержать клуб»
-- ---------------------------------------------------------------------
create or replace function public.sync_sponsor_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if tg_op = 'DELETE' then v_user := old.user_id; else v_user := new.user_id; end if;

  update public.profiles p
     set is_sponsor = exists (
       select 1
         from public.subscriptions s
         join public.payment_products pr on pr.id = s.product_id
        where s.user_id = v_user
          and pr.kind = 'support'
          and s.status in ('active', 'trialing', 'past_due')
     )
   where p.id = v_user;
  return null;
end;
$$;

drop trigger if exists subscriptions_sync_sponsor on public.subscriptions;
create trigger subscriptions_sync_sponsor
  after insert or update or delete on public.subscriptions
  for each row execute function public.sync_sponsor_flag();

revoke execute on function public.sync_sponsor_flag() from public, anon, authenticated;

-- =====================================================================
-- DTT Club — Слой 38: магазин (форма GERA под заказ + свой мерч клуба).
-- Скрипт идемпотентный.
--
-- Как работает:
--  * Ученик выбирает дизайн (Самурай, Бразилия, Тролль, Fight Club…), вещь, взрослый/детский,
--    размер → корзина → shop_place_order() считает цену на сервере → заказ «ждёт оплаты».
--  * Оплата картой: create-checkout { shop_order_id }. Платёж записывает вебхук в payments
--    с примечанием «Магазин: заказ №N» — триггер отмечает заказ оплаченным (сумма и владелец сверяются).
--  * Тренер копит оплаченные заказы и раз в месяц отправляет пачку в GERA:
--    paid → ordered (отправлено в GERA) → arrived (пришло) → handed (выдано).
--  * Цена ученику = розница GERA + 10 % (решение тренера 08.11.2026). Цены GERA лежат в shop_costs —
--    их видит только тренер.
-- =====================================================================

create table if not exists public.shop_designs (
  id          text primary key,
  title       text not null,
  description text,
  club        text not null default 'both' check (club in ('dtt', 'grappling', 'both')),
  images      text[] not null default '{}',   -- пути к картинкам (в приложении: /shop/… или публичный бакет shop)
  sort        int not null default 100,
  active      boolean not null default true
);

create table if not exists public.shop_products (
  id              text primary key,
  brand           text not null default 'gera' check (brand in ('gera', 'dtt')),
  title           text not null,
  description     text,
  price_cents     int not null check (price_cents > 0),
  price_kid_cents int check (price_kid_cents > 0),      -- null — детского варианта нет
  sizes           text[] not null default '{}',          -- пусто — один размер
  kid_sizes       text[] not null default '{}',
  needs_design    boolean not null default true,         -- форма GERA печатается с выбранным дизайном
  made_to_order   boolean not null default true,         -- шьют под заказ (иначе — со склада)
  stock           int check (stock >= 0),                -- для своего мерча: сколько есть; null — не считаем
  image           text,
  sort            int not null default 100,
  active          boolean not null default true
);

-- Закупочные цены (розница GERA) — только тренер.
create table if not exists public.shop_costs (
  product_id     text primary key references public.shop_products(id) on delete cascade,
  cost_cents     int,
  cost_kid_cents int
);

create table if not exists public.shop_orders (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  items       jsonb not null,           -- [{product_id,title,design_id,design_title,variant,size,qty,price_cents}]
  total_cents int not null check (total_cents > 0),
  note        text,
  status      text not null default 'awaiting_payment'
              check (status in ('awaiting_payment', 'paid', 'ordered', 'arrived', 'handed', 'cancelled')),
  payment_id  bigint,
  paid_at     timestamptz,
  ordered_at  timestamptz,
  arrived_at  timestamptz,
  handed_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists shop_orders_user_idx on public.shop_orders(user_id, created_at desc);
create index if not exists shop_orders_status_idx on public.shop_orders(status);

alter table public.shop_designs  enable row level security;
alter table public.shop_products enable row level security;
alter table public.shop_costs    enable row level security;
alter table public.shop_orders   enable row level security;

drop policy if exists shop_designs_read on public.shop_designs;
create policy shop_designs_read on public.shop_designs for select to authenticated using (active or public.is_admin());
drop policy if exists shop_designs_admin on public.shop_designs;
create policy shop_designs_admin on public.shop_designs for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists shop_products_read on public.shop_products;
create policy shop_products_read on public.shop_products for select to authenticated using (active or public.is_admin());
drop policy if exists shop_products_admin on public.shop_products;
create policy shop_products_admin on public.shop_products for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists shop_costs_admin on public.shop_costs;
create policy shop_costs_admin on public.shop_costs for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Заказы: свои видит ученик, все — тренер. Создание и отмена — только через функции ниже.
drop policy if exists shop_orders_read on public.shop_orders;
create policy shop_orders_read on public.shop_orders for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists shop_orders_admin_update on public.shop_orders;
create policy shop_orders_admin_update on public.shop_orders for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke insert, delete on public.shop_orders from authenticated, anon;

-- ---------------------------------------------------------------------
-- Оформить заказ: цены берём из каталога, а не из телефона.
-- p_items: [{ product_id, design_id?, variant: 'adult'|'kid', size?, qty }]
-- ---------------------------------------------------------------------
create or replace function public.shop_place_order(p_items jsonb, p_note text default null)
returns table (order_id bigint, total_cents int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_it    jsonb;
  v_p     public.shop_products;
  v_d     public.shop_designs;
  v_qty   int;
  v_var   text;
  v_size  text;
  v_price int;
  v_out   jsonb := '[]'::jsonb;
  v_total int := 0;
  v_id    bigint;
begin
  if v_uid is null then raise exception 'Войдите в приложение' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Корзина пуста'; end if;
  if jsonb_array_length(p_items) > 20 then raise exception 'Слишком много позиций в одном заказе'; end if;
  -- не больше 3 неоплаченных заказов, чтобы не засоряли список
  if (select count(*) from public.shop_orders o where o.user_id = v_uid and o.status = 'awaiting_payment') >= 3 then
    raise exception 'У вас уже есть неоплаченные заказы — оплатите или отмените их';
  end if;

  for v_it in select * from jsonb_array_elements(p_items) loop
    select * into v_p from public.shop_products where id = v_it->>'product_id' and active;
    if not found then raise exception 'Товар не найден или снят с продажи'; end if;

    v_qty := coalesce((v_it->>'qty')::int, 1);
    if v_qty < 1 or v_qty > 10 then raise exception 'Количество — от 1 до 10'; end if;

    v_var := coalesce(v_it->>'variant', 'adult');
    if v_var = 'kid' then
      if v_p.price_kid_cents is null then raise exception '«%» — нет детского варианта', v_p.title; end if;
      v_price := v_p.price_kid_cents;
    elsif v_var = 'adult' then
      v_price := v_p.price_cents;
    else
      raise exception 'Неизвестный вариант';
    end if;

    v_size := nullif(btrim(coalesce(v_it->>'size', '')), '');
    if cardinality(case when v_var = 'kid' then v_p.kid_sizes else v_p.sizes end) > 0
       and (v_size is null or not v_size = any(case when v_var = 'kid' then v_p.kid_sizes else v_p.sizes end)) then
      raise exception '«%» — выберите размер', v_p.title;
    end if;

    v_d := null;
    if v_p.needs_design then
      select * into v_d from public.shop_designs where id = v_it->>'design_id' and active;
      if not found then raise exception '«%» — выберите дизайн', v_p.title; end if;
    end if;

    if v_p.stock is not null and v_p.stock < v_qty then
      raise exception '«%» — осталось только %', v_p.title, v_p.stock;
    end if;

    v_out := v_out || jsonb_build_object(
      'product_id', v_p.id, 'title', v_p.title, 'brand', v_p.brand,
      'design_id', v_d.id, 'design_title', v_d.title,
      'variant', v_var, 'size', v_size, 'qty', v_qty, 'price_cents', v_price);
    v_total := v_total + v_price * v_qty;
  end loop;

  insert into public.shop_orders (user_id, items, total_cents, note)
  values (v_uid, v_out, v_total, left(nullif(btrim(coalesce(p_note, '')), ''), 300))
  returning id into v_id;

  return query select v_id, v_total;
end;
$$;
revoke execute on function public.shop_place_order(jsonb, text) from public, anon;
grant execute on function public.shop_place_order(jsonb, text) to authenticated;

-- Отменить свой неоплаченный заказ.
create or replace function public.shop_cancel_order(p_order bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.shop_orders set status = 'cancelled'
   where id = p_order and status = 'awaiting_payment' and (user_id = auth.uid() or public.is_admin());
$$;
revoke execute on function public.shop_cancel_order(bigint) from public, anon;
grant execute on function public.shop_cancel_order(bigint) to authenticated;

-- Тренер: перевести заказы дальше (отправлено в GERA → пришло → выдано).
create or replace function public.shop_set_status(p_orders bigint[], p_status text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'Только для тренера' using errcode = '42501'; end if;
  if p_status not in ('paid', 'ordered', 'arrived', 'handed', 'cancelled') then raise exception 'Неизвестный статус'; end if;
  update public.shop_orders
     set status = p_status,
         ordered_at = case when p_status = 'ordered' then now() else ordered_at end,
         arrived_at = case when p_status = 'arrived' then now() else arrived_at end,
         handed_at  = case when p_status = 'handed'  then now() else handed_at  end
   where id = any(p_orders) and status <> 'awaiting_payment';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.shop_set_status(bigint[], text) from public, anon;
grant execute on function public.shop_set_status(bigint[], text) to authenticated;

-- ---------------------------------------------------------------------
-- Оплата пришла (вебхук записал payments с примечанием «Магазин: заказ №N»):
-- отмечаем заказ, если совпадают владелец и сумма; уменьшаем остаток своего мерча.
-- ---------------------------------------------------------------------
create or replace function public.shop_on_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_o  public.shop_orders;
  v_it jsonb;
begin
  if new.status <> 'paid' or new.note is null then return new; end if;
  v_id := (regexp_match(new.note, '^Магазин: заказ №(\d+)$'))[1]::bigint;
  if v_id is null then return new; end if;

  select * into v_o from public.shop_orders
   where id = v_id and user_id = new.user_id and status = 'awaiting_payment' for update;
  if not found or new.amount_cents < v_o.total_cents then return new; end if;

  update public.shop_orders set status = 'paid', paid_at = now(), payment_id = new.id where id = v_id;
  for v_it in select * from jsonb_array_elements(v_o.items) loop
    update public.shop_products set stock = greatest(stock - (v_it->>'qty')::int, 0)
     where id = v_it->>'product_id' and stock is not null;
  end loop;
  return new;
end;
$$;
drop trigger if exists shop_on_payment on public.payments;
create trigger shop_on_payment after insert or update of status on public.payments
  for each row execute function public.shop_on_payment();

-- Платёж вернули — заказ снова «ждёт оплаты» не делаем, а отменяем (тренер увидит).
create or replace function public.shop_on_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'refunded' and old.status is distinct from 'refunded' then
    update public.shop_orders set status = 'cancelled' where payment_id = new.id and status in ('paid', 'ordered');
  end if;
  return new;
end;
$$;
drop trigger if exists shop_on_refund on public.payments;
create trigger shop_on_refund after update of status on public.payments
  for each row execute function public.shop_on_refund();

-- ---------------------------------------------------------------------
-- Каталог: дизайны (картинки лежат в приложении: public/shop/…)
-- ---------------------------------------------------------------------
insert into public.shop_designs (id, title, description, club, images, sort) values
  ('samurai', 'Самурай', 'Красный, Daugavpils Grappling Team', 'grappling',
     array['shop/samurai-rashguard.jpg','shop/samurai-rashguard-ls.jpg','shop/samurai-shorts.jpg','shop/samurai-leggings.jpg'], 10),
  ('brazil', 'Brazilian Jiu-Jitsu', 'Сине-жёлто-зелёный, Daugavpils Grappling Team', 'grappling',
     array['shop/brazil-tee.jpg','shop/brazil-rashguard-ls.jpg','shop/brazil-shorts.jpg','shop/brazil-leggings.jpg'], 20),
  ('troll', 'Rollin'' Troll', 'Чёрный с молниями, Daugavpils Grappling Team', 'grappling',
     array['shop/troll-rashguard.jpg','shop/troll-tee.jpg','shop/troll-shorts.jpg','shop/troll-leggings.jpg'], 30),
  ('fightclub', 'Daugavpils Fight Club', 'Чёрно-красный, Daugavpils Top Team', 'dtt',
     array['shop/fightclub-tee.jpg','shop/fightclub-rashguard-ls.jpg','shop/fightclub-shorts.jpg','shop/fightclub-leggings.jpg',
           'shop/fightclub-hoodie.jpg','shop/fightclub-jacket.jpg','shop/fightclub-pants.jpg'], 40)
on conflict (id) do nothing;

-- Вещи GERA: (код, название, розница GERA взр/дет в центах, порядок). Цена ученику = +10 %, до 10 центов.
with gera(id, title, cost, cost_kid, sort, has_sizes) as (values
  ('rashguard_ss',  'Рашгард, короткий рукав',            2800, 2400,  10, true),
  ('rashguard_ls',  'Рашгард, длинный рукав',             3300, 2800,  20, true),
  ('shorts_velcro', 'Шорты для MMA на липучке',           3100, 2700,  30, true),
  ('shorts_light',  'Шорты для MMA, тонкая ткань',        3100, 2600,  40, true),
  ('shorts_elastic','Шорты для MMA на резинке',           2925, 2500,  50, true),
  ('compression',   'Компрессионные шорты',               2000, 1700,  60, true),
  ('leggings',      'Легинсы',                            3800, 3300,  70, true),
  ('hoodie',        'Кофта с капюшоном',                  4200, 3600,  80, true),
  ('sweatshirt',    'Кофта без капюшона',                 3700, 3300,  90, true),
  ('pants_slim',    'Брюки зауженные',                    3100, 2800, 100, true),
  ('pants_straight','Брюки прямые',                       4000, 3400, 110, true),
  ('pants_cuffs',   'Брюки на манжетах',                  3700, 3200, 120, true),
  ('tshirt',        'Прогулочная футболка',               1800, 1500, 130, true),
  ('windbreaker',   'Ветровка',                           5400, 4600, 140, true),
  ('vest',          'Жилетка',                            3900, 3400, 150, true),
  ('backpack',      'Сумка-рюкзак',                       3300, null::int, 160, false),
  ('gear_bag',      'Большая сумка для экипировки',       3500, null::int, 170, false),
  ('waist_bag',     'Бананка',                            1400, null::int, 180, false)
)
insert into public.shop_products (id, brand, title, price_cents, price_kid_cents, sizes, kid_sizes, sort)
select id, 'gera', title,
       (round(cost * 1.1 / 10.0) * 10)::int,
       case when cost_kid is null then null else (round(cost_kid * 1.1 / 10.0) * 10)::int end,
       case when has_sizes then array['S','M','L','XL','XXL','XXXL'] else '{}'::text[] end,
       case when has_sizes and cost_kid is not null then array['8XS','7XS','6XS','5XS','4XS','3XS','XXS','XS'] else '{}'::text[] end,
       sort
  from gera
on conflict (id) do nothing;

insert into public.shop_costs (product_id, cost_cents, cost_kid_cents)
select id, cost, cost_kid from (values
  ('rashguard_ss',2800,2400),('rashguard_ls',3300,2800),('shorts_velcro',3100,2700),('shorts_light',3100,2600),
  ('shorts_elastic',2925,2500),('compression',2000,1700),('leggings',3800,3300),('hoodie',4200,3600),
  ('sweatshirt',3700,3300),('pants_slim',3100,2800),('pants_straight',4000,3400),('pants_cuffs',3700,3200),
  ('tshirt',1800,1500),('windbreaker',5400,4600),('vest',3900,3400),('backpack',3300,null::int),('gear_bag',3500,null::int),('waist_bag',1400,null::int)
) as c(id, cost, cost_kid)
on conflict (product_id) do update set cost_cents = excluded.cost_cents, cost_kid_cents = excluded.cost_kid_cents;

-- ---------------------------------------------------------------------
-- Фото своего мерча (брелоки, аксессуары): публичный бакет shop, загружает только тренер.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('shop', 'shop', true) on conflict (id) do nothing;
drop policy if exists shop_bucket_admin_write on storage.objects;
create policy shop_bucket_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'shop' and public.is_admin());
drop policy if exists shop_bucket_admin_delete on storage.objects;
create policy shop_bucket_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'shop' and public.is_admin());

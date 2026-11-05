-- =====================================================================
-- DTT Club — Слой 9: QR-чекин, оплата наличными, список должников.
-- Выполнить ПОСЛЕ layer8_booking.sql. Скрипт идемпотентный.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Посещение привязывается к занятию (для QR-чекина)
-- ---------------------------------------------------------------------
alter table public.attendance add column if not exists session_id bigint
  references public.training_sessions (id) on delete set null;
alter table public.attendance add column if not exists method text not null default 'coach';
alter table public.attendance drop constraint if exists attendance_method_check;
alter table public.attendance add constraint attendance_method_check check (method in ('coach', 'qr'));

-- Один чекин на занятие (отметки тренера без занятия не ограничиваем).
create unique index if not exists attendance_session_athlete_uq
  on public.attendance (session_id, athlete_id) where session_id is not null;


-- ---------------------------------------------------------------------
-- 2. Короткоживущие QR-коды занятия. Экран тренера обновляет код каждые
--    30 с, код живёт 2 минуты — фото QR, отправленное другу домой, быстро
--    перестаёт работать.
-- ---------------------------------------------------------------------
create table if not exists public.checkin_tokens (
  token      text primary key,
  session_id bigint      not null references public.training_sessions (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists checkin_tokens_expires_idx on public.checkin_tokens (expires_at);

alter table public.checkin_tokens enable row level security;
revoke all on public.checkin_tokens from anon, authenticated;  -- только через функции


-- Тренер: новый QR-код для занятия.
create or replace function public.checkin_qr(p_session bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_ends  timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Только тренер показывает QR-код' using errcode = '42501';
  end if;

  select ends_at into v_ends from public.training_sessions where id = p_session and not cancelled;
  if v_ends is null then
    raise exception 'Занятие не найдено или отменено';
  end if;

  delete from public.checkin_tokens where expires_at < now() - interval '1 hour';

  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into public.checkin_tokens (token, session_id, expires_at)
  values (v_token, p_session, least(now() + interval '2 minutes', v_ends + interval '30 minutes'));
  return v_token;
end;
$$;


-- Ученик: отметиться по QR-коду. Возвращает новое число тренировок.
create or replace function public.check_in(p_token text)
returns table (trainings integer, session_title text, already boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_session bigint;
  v_starts  timestamptz;
  v_title   text;
  v_count   integer;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение, чтобы отметиться' using errcode = '42501';
  end if;

  select t.session_id, ts.starts_at, s.title
    into v_session, v_starts, v_title
    from public.checkin_tokens t
    join public.training_sessions ts on ts.id = t.session_id
    join public.training_slots s on s.id = ts.slot_id
   where t.token = p_token and t.expires_at > now();

  if v_session is null then
    raise exception 'QR-код устарел. Отсканируйте код на экране тренера ещё раз.';
  end if;
  if now() < v_starts - interval '1 hour' then
    raise exception 'Отметиться можно не раньше чем за час до начала тренировки';
  end if;

  -- Уже отмечен на этом занятии — не считаем второй раз.
  if exists (select 1 from public.attendance where session_id = v_session and athlete_id = v_uid) then
    select p.trainings_count into v_count from public.profiles p where p.id = v_uid;
    return query select v_count, v_title, true;
    return;
  end if;

  insert into public.attendance (athlete_id, marked_by, session_id, method)
  values (v_uid, v_uid, v_session, 'qr');

  update public.profiles set trainings_count = trainings_count + 1
   where id = v_uid
  returning trainings_count into v_count;

  return query select v_count, v_title, false;
end;
$$;

revoke execute on function public.checkin_qr(bigint), public.check_in(text) from public, anon;
grant  execute on function public.checkin_qr(bigint), public.check_in(text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Оплата наличными (тренер отмечает в CRM)
-- ---------------------------------------------------------------------
alter table public.payments add column if not exists method text not null default 'card';
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (method in ('card', 'cash'));
-- Для абонемента наличными: до какого числа оплачен.
alter table public.payments add column if not exists period_end timestamptz;

create or replace function public.record_cash_payment(p_athlete uuid, p_product text)
returns timestamptz   -- «оплачено до» для абонемента, иначе null
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind   text;
  v_amount integer;
  v_from   timestamptz;
  v_end    timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Только тренер отмечает оплату наличными' using errcode = '42501';
  end if;

  select kind, amount_cents into v_kind, v_amount
    from public.payment_products where id = p_product and active;
  if v_kind is null or v_kind not in ('membership', 'single') then
    raise exception 'Неизвестный товар';
  end if;

  if v_kind = 'membership' then
    -- Продлеваем от конца уже оплаченного периода, если он ещё не истёк.
    select greatest(now(), coalesce(max(period_end), now())) into v_from
      from public.payments
     where user_id = p_athlete and method = 'cash' and status = 'paid' and period_end is not null;
    v_end := v_from + interval '1 month';
  end if;

  insert into public.payments (user_id, product_id, amount_cents, currency, status, method, period_end)
  values (p_athlete, p_product, v_amount, 'eur', 'paid', 'cash', v_end);
  return v_end;
end;
$$;

revoke execute on function public.record_cash_payment(uuid, text) from public, anon;
grant  execute on function public.record_cash_payment(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Должники (только тренер)
--    • абонемент по карте, а списание не прошло (past_due / unpaid);
--    • за 30 дней тренировок больше, чем оплачено разовых, и нет действующего
--      абонемента (карта или наличные). Первая тренировка в клубе — бесплатно.
-- ---------------------------------------------------------------------
create or replace function public.payment_debtors()
returns table (athlete_id uuid, first_name text, last_name text, reason text, unpaid integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Только для тренера' using errcode = '42501';
  end if;

  return query
  with month_att as (
    select a.athlete_id, count(*)::integer as cnt
      from public.attendance a
     where a.created_at > now() - interval '30 days'
     group by a.athlete_id
  ),
  first_att as (
    select a.athlete_id, min(a.created_at) as first_at
      from public.attendance a group by a.athlete_id
  ),
  singles as (
    select p.user_id, count(*)::integer as cnt
      from public.payments p
      join public.payment_products pr on pr.id = p.product_id
     where pr.kind = 'single' and p.status = 'paid' and p.created_at > now() - interval '30 days'
     group by p.user_id
  ),
  card_live as (
    select s.user_id, s.status
      from public.subscriptions s
      join public.payment_products pr on pr.id = s.product_id
     where pr.kind = 'membership' and s.status in ('active', 'trialing', 'past_due', 'unpaid')
  ),
  cash_live as (
    select distinct p.user_id from public.payments p
     where p.method = 'cash' and p.status = 'paid' and p.period_end > now()
  )
  select pf.id, pf.first_name, pf.last_name,
         case when cl.status in ('past_due', 'unpaid') then 'Не прошло списание абонемента'
              else 'Тренировки без оплаты' end,
         case when cl.status in ('past_due', 'unpaid') then null
              else ma.cnt - coalesce(sg.cnt, 0)
                   - (case when fa.first_at > now() - interval '30 days' then 1 else 0 end) end
    from public.profiles pf
    left join month_att ma on ma.athlete_id = pf.id
    left join first_att fa on fa.athlete_id = pf.id
    left join singles   sg on sg.user_id = pf.id
    left join card_live cl on cl.user_id = pf.id
    left join cash_live cs on cs.user_id = pf.id
   where pf.role <> 'admin'
     and (
       cl.status in ('past_due', 'unpaid')
       or (cl.user_id is null and cs.user_id is null
           and coalesce(ma.cnt, 0) - coalesce(sg.cnt, 0)
               - (case when fa.first_at > now() - interval '30 days' then 1 else 0 end) > 0)
     )
   order by pf.last_name;
end;
$$;

revoke execute on function public.payment_debtors() from public, anon;
grant  execute on function public.payment_debtors() to authenticated;

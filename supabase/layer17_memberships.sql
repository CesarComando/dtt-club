-- =====================================================================
-- DTT Club — Слой 17: абонемент у каждого — месяц от дня оплаты;
-- индивидуальная цена разовой тренировки.
-- Выполнить ПОСЛЕ layer16_approval.sql. Скрипт идемпотентный.
--
-- Правило: абонемент действует месяц со дня оплаты (оплатил 7 октября —
-- до 7 ноября). Если оплатил раньше, чем закончился прошлый, новый месяц
-- идёт с конца прошлого — оплаченные дни не теряются.
-- Источники: переводы/наличные из списка учеников клуба (member_payments,
-- kind = 'membership'), наличные в приложении (payments.period_end),
-- подписка картой (subscriptions.current_period_end).
-- =====================================================================

-- Индивидуальная цена разовой (null = обычная по прайсу).
alter table public.club_members add column if not exists single_price_cents integer
  check (single_price_cents is null or single_price_cents > 0);
comment on column public.club_members.single_price_cents is
  'Индивидуальная цена разовой тренировки (центы). Только для отдельных учеников.';


-- До какого дня действует абонемент ученика клуба по переводам/наличным.
create or replace function public.member_membership_until(p_member bigint)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_end date;
  r record;
begin
  -- Несколько переводов за абонемент в один день (напр. 15 € + 30 €) — это один месяц.
  for r in
    select distinct paid_on from public.member_payments
     where member_id = p_member and kind = 'membership'
     order by paid_on
  loop
    v_end := (greatest(r.paid_on, coalesce(v_end, r.paid_on)) + interval '1 month')::date;
  end loop;
  return v_end;
end;
$$;
revoke execute on function public.member_membership_until(bigint) from public, anon, authenticated;


-- Абонементы: по ученику клуба и/или аккаунту — до какого числа и откуда.
-- Тренер видит всех, ученик — только себя (p_only_me).
create or replace function public.membership_overview(p_only_me boolean default false)
returns table (
  member_id   bigint,
  profile_id  uuid,
  first_name  text,
  last_name   text,
  discipline  text,
  last_paid   date,
  valid_until date,
  source      text,      -- 'card' | 'cash' | 'bank'
  active      boolean,
  single_price_cents integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;
  if not p_only_me and not public.is_admin() then
    raise exception 'Только для тренера' using errcode = '42501';
  end if;

  return query
  with people as (
    -- ученики клуба (+ связанный аккаунт) и аккаунты без записи в клубе
    select m.id as mid, m.profile_id as pid, m.first_name as fn, m.last_name as ln,
           coalesce(p.discipline, m.discipline) as disc, m.single_price_cents as spc
      from public.club_members m
      left join public.profiles p on p.id = m.profile_id
    union all
    select null, p.id, p.first_name, p.last_name, p.discipline, null
      from public.profiles p
     where p.role <> 'admin'
       and not exists (select 1 from public.club_members m where m.profile_id = p.id)
  ),
  sources as (
    select pe.mid, pe.pid, 'bank'::text as src,
           (select max(mp.paid_on) from public.member_payments mp
             where mp.member_id = pe.mid and mp.kind = 'membership') as paid,
           public.member_membership_until(pe.mid) as until
      from people pe where pe.mid is not null
    union all
    select pe.mid, pe.pid, 'cash',
           (max(pa.created_at) at time zone 'Europe/Riga')::date,
           (max(pa.period_end) at time zone 'Europe/Riga')::date
      from people pe
      join public.payments pa on pa.user_id = pe.pid
     where pa.method = 'cash' and pa.status = 'paid' and pa.period_end is not null
     group by pe.mid, pe.pid
    union all
    select pe.mid, pe.pid, 'card',
           ((max(s.current_period_end) - interval '1 month') at time zone 'Europe/Riga')::date,  -- начало текущего периода
           (max(s.current_period_end) at time zone 'Europe/Riga')::date
      from people pe
      join public.subscriptions s on s.user_id = pe.pid
      join public.payment_products pr on pr.id = s.product_id
     where pr.kind = 'membership' and s.status in ('active', 'trialing', 'past_due')
     group by pe.mid, pe.pid
  ),
  best as (
    select distinct on (coalesce(so.mid::text, so.pid::text))
           so.mid, so.pid, so.src, so.paid, so.until
      from sources so
     where so.until is not null
     order by coalesce(so.mid::text, so.pid::text), so.until desc
  )
  select pe.mid, pe.pid, pe.fn, pe.ln, pe.disc, b.paid, b.until, b.src,
         coalesce(b.until >= (now() at time zone 'Europe/Riga')::date, false),
         pe.spc
    from people pe
    left join best b on coalesce(b.mid::text, b.pid::text) = coalesce(pe.mid::text, pe.pid::text)
   where not p_only_me or pe.pid = v_uid
   order by (b.until is null), b.until desc, pe.ln, pe.fn;
end;
$$;
revoke execute on function public.membership_overview(boolean) from public, anon;
grant execute on function public.membership_overview(boolean) to authenticated;


-- Наличные в приложении: тоже месяц от дня оплаты (или от конца действующего).
create or replace function public.record_cash_payment(p_athlete uuid, p_product text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind   text;
  v_amount integer;
  v_from   timestamptz;
  v_end    timestamptz;
  v_member bigint;
  v_bank   date;
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
    select greatest(now(), coalesce(max(period_end), now())) into v_from
      from public.payments
     where user_id = p_athlete and method = 'cash' and status = 'paid' and period_end is not null;
    -- учитываем и абонемент, оплаченный переводом (список учеников клуба)
    select id into v_member from public.club_members where profile_id = p_athlete limit 1;
    if v_member is not null then
      v_bank := public.member_membership_until(v_member);
      if v_bank is not null and (v_bank::timestamp at time zone 'Europe/Riga') > v_from then
        v_from := v_bank::timestamp at time zone 'Europe/Riga';
      end if;
    end if;
    v_end := v_from + interval '1 month';
  end if;

  insert into public.payments (user_id, product_id, amount_cents, currency, status, method, period_end)
  values (p_athlete, p_product, v_amount, 'eur', 'paid', 'cash', v_end);
  return v_end;
end;
$$;
revoke execute on function public.record_cash_payment(uuid, text) from public, anon;
grant  execute on function public.record_cash_payment(uuid, text) to authenticated;


-- Должники: абонемент переводом (список клуба) тоже считается действующим.
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
  ),
  bank_live as (
    select m.profile_id as user_id from public.club_members m
     where m.profile_id is not null
       and public.member_membership_until(m.id) >= (now() at time zone 'Europe/Riga')::date
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
    left join bank_live bl on bl.user_id = pf.id
   where pf.role <> 'admin'
     and (
       cl.status in ('past_due', 'unpaid')
       or (cl.user_id is null and cs.user_id is null and bl.user_id is null
           and coalesce(ma.cnt, 0) - coalesce(sg.cnt, 0)
               - (case when fa.first_at > now() - interval '30 days' then 1 else 0 end) > 0)
     )
   order by pf.last_name;
end;
$$;
revoke execute on function public.payment_debtors() from public, anon;
grant execute on function public.payment_debtors() to authenticated;

-- Слой 47: касса тренера.
--
-- Помощник тренера (role = 'coach') сам вносит оплаты своих учеников (MMA / both).
-- Эти оплаты:
--   • продлевают ученику абонемент и убирают его из должников (как обычные оплаты);
--   • НЕ входят в бюджет клуба (budget_overview) — это касса тренера;
--   • видны тренеру (только свои) и главному тренеру (все).
-- Деньги, которые тренер сдаёт главному тренеру, остаются в бюджете клуба
-- (служебная запись club_members.cashbox_of = тренер) и показываются в его кассе как «сдано».

alter table public.member_payments
  add column if not exists ledger text not null default 'club' check (ledger in ('club', 'coach')),
  add column if not exists recorded_by uuid references public.profiles (id) on delete set null;
create index if not exists member_payments_coach_idx on public.member_payments (recorded_by) where ledger = 'coach';

alter table public.club_members
  add column if not exists cashbox_of uuid references public.profiles (id) on delete set null;

-- Служебная запись «Касса тренера — Андрей Бобров» → его профиль.
update public.club_members
   set cashbox_of = (select id from public.profiles where role = 'coach' and first_name = 'Андрей' and last_name = 'Бобров' limit 1)
 where first_name = 'Касса тренера' and last_name = 'Андрей Бобров' and cashbox_of is null;

-- Бюджет клуба: только касса клуба.
create or replace function public.budget_overview()
 returns table(month date, income_bank integer, income_app integer, expenses integer, by_category jsonb)
 language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not public.is_admin() then
    raise exception 'Бюджет видит только главный тренер' using errcode = '42501';
  end if;

  return query
  with months as (
    select date_trunc('month', paid_on)::date m from public.member_payments where ledger = 'club'
    union select date_trunc('month', created_at at time zone 'Europe/Riga')::date from public.payments where status = 'paid'
    union select date_trunc('month', spent_on)::date from public.club_expenses
  ),
  mp as (select date_trunc('month', paid_on)::date m, sum(amount_cents)::int s
           from public.member_payments where ledger = 'club' group by 1),
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
$function$;

-- Ученики, которым тренер может внести оплату (только имена).
create or replace function public.coach_members()
returns table (id bigint, first_name text, last_name text, discipline text, free_training boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Только для тренера' using errcode = '42501'; end if;
  return query
  select m.id, m.first_name, m.last_name, coalesce(p.discipline, m.discipline), m.free_training
    from public.club_members m
    left join public.profiles p on p.id = m.profile_id
   where m.status <> 'left' and m.cashbox_of is null
     and (public.is_admin() or coalesce(p.discipline, m.discipline) in ('mma', 'both'))
   order by m.first_name, m.last_name;
end;
$$;

create or replace function public.coach_add_payment(
  p_member bigint, p_amount_cents integer, p_paid_on date, p_method text, p_kind text, p_note text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id bigint;
begin
  if not public.is_staff() then raise exception 'Только для тренера' using errcode = '42501'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000 then raise exception 'Сумма от 0,01 до 1000 €'; end if;
  if p_method not in ('cash', 'bank') then raise exception 'Способ: наличные или перевод'; end if;
  if p_kind not in ('training', 'membership', 'individual', 'pack') then raise exception 'Неизвестный вид оплаты'; end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Europe/Riga')::date or p_paid_on < (now() at time zone 'Europe/Riga')::date - 60 then
    raise exception 'Дата — не в будущем и не раньше чем 60 дней назад';
  end if;
  if not exists (
    select 1 from public.club_members m left join public.profiles p on p.id = m.profile_id
     where m.id = p_member and m.cashbox_of is null and m.status <> 'left'
       and (public.is_admin() or coalesce(p.discipline, m.discipline) in ('mma', 'both'))
  ) then raise exception 'Этому ученику оплату внести нельзя'; end if;

  insert into public.member_payments (member_id, paid_on, amount_cents, kind, method, description, ledger, recorded_by)
  values (p_member, p_paid_on, p_amount_cents, p_kind, p_method,
          nullif(btrim(coalesce(p_note, '')), '') , 'coach', v_uid)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Такая оплата уже внесена';
end;
$$;

create or replace function public.coach_delete_payment(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Только для тренера' using errcode = '42501'; end if;
  delete from public.member_payments
   where id = p_id and ledger = 'coach'
     and (public.is_admin() or recorded_by = auth.uid());
  if not found then raise exception 'Эту запись удалить нельзя'; end if;
end;
$$;

-- Касса: оплаты, внесённые тренером (income), и то, что он сдал главному тренеру (handover).
-- Тренер видит только свою кассу; главный тренер — все.
create or replace function public.coach_ledger()
returns table (
  id bigint, entry text, paid_on date, amount_cents integer, method text, kind text,
  member_name text, note text, coach_id uuid, coach_name text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_admin boolean := public.is_admin();
begin
  if not public.is_staff() then raise exception 'Только для тренера' using errcode = '42501'; end if;
  return query
  select mp.id, 'income'::text, mp.paid_on, mp.amount_cents, mp.method, mp.kind,
         btrim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')), mp.description,
         mp.recorded_by, btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), mp.created_at
    from public.member_payments mp
    join public.club_members m on m.id = mp.member_id
    left join public.profiles c on c.id = mp.recorded_by
   where mp.ledger = 'coach' and (v_admin or mp.recorded_by = auth.uid())
  union all
  select mp.id, 'handover', mp.paid_on, mp.amount_cents, mp.method, mp.kind,
         null, mp.description, m.cashbox_of,
         btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), mp.created_at
    from public.member_payments mp
    join public.club_members m on m.id = mp.member_id
    left join public.profiles c on c.id = m.cashbox_of
   where m.cashbox_of is not null and (v_admin or m.cashbox_of = auth.uid())
   order by 3 desc, 11 desc;
end;
$$;

revoke execute on function public.coach_members(), public.coach_add_payment(bigint, integer, date, text, text, text),
  public.coach_delete_payment(bigint), public.coach_ledger() from anon, public;
grant execute on function public.coach_members(), public.coach_add_payment(bigint, integer, date, text, text, text),
  public.coach_delete_payment(bigint), public.coach_ledger() to authenticated;

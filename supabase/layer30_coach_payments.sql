-- =====================================================================
-- DTT Club — Слой 30: помощник тренера видит, кто оплатил MMA / K1.
-- Выполнить ПОСЛЕ layer20_staff.sql. Скрипт идемпотентный.
--
-- membership_overview(): тренер (admin) — как раньше, все ученики.
-- Помощник (coach) — только ученики MMA / K1 (discipline 'mma' или 'both'):
-- имя, до какого числа абонемент, способ оплаты. Особая цена разовой скрыта.
-- Суммы, история платежей, бюджет, должники и телефоны помощнику по-прежнему недоступны.
-- =====================================================================

create or replace function public.membership_overview(p_only_me boolean default false)
returns table (member_id bigint, profile_id uuid, first_name text, last_name text, discipline text,
               last_paid date, valid_until date, source text, active boolean, single_price_cents integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean := public.is_admin();
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;
  if not p_only_me and not public.is_staff() then
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
     where p.role = 'athlete'
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
         case when v_admin or p_only_me then pe.spc end
    from people pe
    left join best b on coalesce(b.mid::text, b.pid::text) = coalesce(pe.mid::text, pe.pid::text)
   where (p_only_me and pe.pid = v_uid)
      or (not p_only_me and (v_admin or pe.disc in ('mma', 'both')))
   order by (b.until is null), b.until desc, pe.ln, pe.fn;
end;
$$;

revoke execute on function public.membership_overview(boolean) from public, anon;
grant execute on function public.membership_overview(boolean) to authenticated;

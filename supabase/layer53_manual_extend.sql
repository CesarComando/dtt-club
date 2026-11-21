-- =====================================================================
-- DTT Club — Слой 53: ручное продление абонемента.
-- Тренер может продлить абонемент ученику до нужной даты без новой оплаты
-- (напр. «продлили до 31 декабря»). Итог = позже из двух: по оплатам или вручную.
-- Все места (абонементы, должники, семья, касса) берут дату из member_membership_until.
-- Скрипт идемпотентный.
-- =====================================================================

alter table public.club_members add column if not exists membership_extended_until date;
comment on column public.club_members.membership_extended_until is
  'Абонемент продлён вручную до этой даты (без оплаты). null — нет.';

create or replace function public.member_membership_until(p_member bigint)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_end date;
  v_manual date;
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
  select membership_extended_until into v_manual from public.club_members where id = p_member;
  -- greatest() пропускает null
  return greatest(v_end, v_manual);
end;
$$;
revoke execute on function public.member_membership_until(bigint) from public, anon, authenticated;

-- Сергей Тяжкин (Sergejs Tjažkins): продлён до 31.12.2026
update public.club_members set membership_extended_until = '2026-12-31'
 where id = 20 and first_name = 'Sergejs' and last_name = 'Tjažkins';

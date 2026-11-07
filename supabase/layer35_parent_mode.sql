-- =====================================================================
-- DTT Club — Слой 35: режим родителя.
-- Выполнить ПОСЛЕ layer17 и layer24. Скрипт идемпотентный.
--
-- my_family() → { parent_only, children: [{ name, valid_until, active }] }
-- Дети родителя:
--   * аккаунты детей (profiles.parent_id = я) и их записи в клубе;
--   * ученики клуба, к которым тренер привязал мой телефон кнопкой «Родитель…»
--     (club_contacts.source = 'coach' — подтверждено тренером, а не самим человеком).
-- parent_only — я сам не тренируюсь (нет своей записи в клубе), значит в кабинете
-- показываем только детское MMA: абонемент ребёнка и детские занятия.
-- =====================================================================

create or replace function public.my_family()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_phone text;
  v_kids  jsonb;
  v_self  boolean;
  v_today date := (now() at time zone 'Europe/Riga')::date;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;
  select phone into v_phone from public.profile_contacts where id = v_uid;

  with kids as (
    select m.id as mid, m.profile_id as pid, m.first_name as fn
      from public.club_members m
     where coalesce(m.profile_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_uid
       and (m.profile_id in (select p.id from public.profiles p where p.parent_id = v_uid)
            or (v_phone is not null and exists (
                  select 1 from public.club_contacts c
                   where c.member_id = m.id and c.source = 'coach' and c.phone = v_phone)))
    union all
    select null, p.id, p.first_name
      from public.profiles p
     where p.parent_id = v_uid
       and not exists (select 1 from public.club_members m where m.profile_id = p.id)
  ),
  st as (
    select k.fn,
           greatest(
             case when k.mid is not null then public.member_membership_until(k.mid) end,
             (select (max(pa.period_end) at time zone 'Europe/Riga')::date
                from public.payments pa
               where k.pid is not null and pa.user_id = k.pid and pa.status = 'paid' and pa.period_end is not null),
             (select (max(su.current_period_end) at time zone 'Europe/Riga')::date
                from public.subscriptions su
                join public.payment_products pr on pr.id = su.product_id
               where k.pid is not null and su.user_id = k.pid and pr.kind = 'membership'
                 and su.status in ('active', 'trialing', 'past_due'))
           ) as until
      from kids k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', st.fn, 'valid_until', st.until,
           'active', coalesce(st.until >= v_today, false)) order by st.fn), '[]'::jsonb)
    into v_kids
    from st;

  select exists (select 1 from public.club_members m where m.profile_id = v_uid)
      or exists (select 1 from public.profiles p where p.id = v_uid and (p.role <> 'athlete' or p.parent_id is not null))
    into v_self;

  return jsonb_build_object(
    'parent_only', jsonb_array_length(v_kids) > 0 and not v_self,
    'children', v_kids);
end;
$$;
revoke execute on function public.my_family() from public, anon;
grant execute on function public.my_family() to authenticated;

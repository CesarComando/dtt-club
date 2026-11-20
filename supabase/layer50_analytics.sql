-- =====================================================================
-- DTT Club — Слой 50: «Аналитика» во вкладке «Бюджет» (только главный тренер).
-- Одна функция club_analytics() собирает всё для графиков:
--   • months  — по месяцам: доход, расходы, платящие, новые, ушедшие, разовые, посещения;
--   • weekday — посещения по дням недели (сколько в среднем на одну тренировку);
--   • heat    — день недели × час начала тренировки;
--   • groups  — группы: посещения, проведено тренировок, заполненность;
--   • mix     — из чего доход с начала помесячного учёта (не больше года) (абонементы, разовые, индивидуальные…);
--   • disciplines — доход по направлениям по месяцам;
--   • lost    — кто платил регулярно, но пропал (нет оплаты и посещений 35+ дней).
-- Касса тренера (ledger = 'coach') и служебные записи (cashbox_of) не учитываются — как в budget_overview.
-- Выполнить после layer51 (нужна колонка payments.refunded_cents). Скрипт идемпотентный, данные не меняет.
-- =====================================================================

create or replace function public.club_analytics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz      constant text := 'Europe/Riga';
  v_today   date := (now() at time zone 'Europe/Riga')::date;
  v_result  jsonb;
  v_from    date;  -- начало помесячного учёта (до него — только годовой итог одной суммой)
begin
  if not public.is_admin() then
    raise exception 'Аналитику видит только главный тренер' using errcode = '42501';
  end if;

  select greatest(coalesce(min(paid_on), v_today), v_today - 365) into v_from
    from public.member_payments
   where ledger = 'club' and kind in ('membership', 'training', 'pack', 'individual');

  with
  -- Оплаты учеников в кассу клуба (без служебных записей кассы тренера)
  mp as (
    select p.member_id, p.paid_on, p.amount_cents, p.kind, coalesce(m.discipline, 'none') discipline
      from public.member_payments p
      join public.club_members m on m.id = p.member_id
     where p.ledger = 'club' and m.cashbox_of is null
  ),
  -- Оплаты через приложение: привязываем к ученику из списка клуба, если он связан с профилем
  ap as (
    select (p.created_at at time zone v_tz)::date paid_on, p.amount_cents - p.refunded_cents as amount_cents,
           coalesce(cm.id, -1) member_id, p.user_id athlete_id
      from public.payments p
      left join public.club_members cm on cm.profile_id = p.user_id
     where p.status = 'paid'
  ),
  -- Кто платил в каком месяце (оба источника; оплата за форму/донат — не «платящий ученик»)
  payer_month as (
    select distinct member_id::text who, date_trunc('month', paid_on)::date m
      from mp where kind in ('membership', 'training', 'pack', 'individual')
    union
    select distinct case when member_id > 0 then member_id::text else athlete_id::text end,
           date_trunc('month', paid_on)::date
      from ap
  ),
  first_month as (select who, min(m) m from payer_month group by who),
  -- Имя и фамилия плательщика: из списка клуба (id) или из профиля приложения (uuid)
  who_name as (
    select pm.who,
           coalesce(
             (select trim(c.first_name || ' ' || coalesce(c.last_name, '')) from public.club_members c
               where pm.who !~ '-' and c.id = pm.who::bigint),
             (select trim(p.first_name || ' ' || coalesce(p.last_name, '')) from public.profiles p
               where pm.who ~ '-' and p.id = pm.who::uuid),
             '?') name
      from (select distinct who from payer_month) pm
  ),
  -- Посещения: время берём у тренировки; ручные отметки без тренировки идут только в помесячный счёт
  att as (
    select a.athlete_id, a.session_id,
           coalesce(s.starts_at, a.created_at) at time zone v_tz as at_local,
           s.slot_id
      from public.attendance a
      left join public.training_sessions s on s.id = a.session_id
  ),
  att_start as (select coalesce(min(at_local)::date, v_today) d from att),
  -- Проведённые тренировки с начала учёта посещений (не отменённые, уже начавшиеся)
  held as (
    select s.id, s.slot_id, s.capacity, s.starts_at at time zone v_tz as at_local
      from public.training_sessions s, att_start
     where not s.cancelled
       and s.starts_at <= now()
       and (s.starts_at at time zone v_tz)::date >= att_start.d
  ),
  month_list as (
    select generate_series(
             date_trunc('month', least(
               coalesce((select min(paid_on) from mp), v_today),
               coalesce((select min(spent_on) from public.club_expenses), v_today))),
             date_trunc('month', v_today), interval '1 month')::date m
  ),
  months as (
    select ml.m,
           coalesce((select sum(amount_cents) from mp where date_trunc('month', paid_on) = ml.m), 0)
             + coalesce((select sum(amount_cents) from ap where date_trunc('month', paid_on) = ml.m), 0) income,
           coalesce((select sum(amount_cents) from public.club_expenses e where date_trunc('month', e.spent_on) = ml.m), 0) expenses,
           (select count(*) from payer_month pm where pm.m = ml.m) payers,
           (select count(*) from first_month f where f.m = ml.m) new_payers,
           (select count(*) from payer_month pm
             where pm.m = (ml.m - interval '1 month')::date
               and not exists (select 1 from payer_month x where x.who = pm.who and x.m = ml.m)) lost,
           -- Имена: кто впервые заплатил и кто не заплатил после прошлого месяца
           coalesce((select jsonb_agg(n.name order by n.name) from first_month f join who_name n using (who)
                      where f.m = ml.m), '[]') new_names,
           coalesce((select jsonb_agg(n.name order by n.name) from payer_month pm join who_name n using (who)
                      where pm.m = (ml.m - interval '1 month')::date
                        and not exists (select 1 from payer_month x where x.who = pm.who and x.m = ml.m)), '[]') lost_names,
           (select count(*) from mp where kind = 'training' and date_trunc('month', paid_on) = ml.m) singles,
           (select count(*) from att where date_trunc('month', at_local) = ml.m) visits
      from month_list ml
  ),
  dows as (select generate_series(1, 7) dow)
  select jsonb_build_object(
    'today', v_today,
    'attendance_since', (select d from att_start),
    'months', coalesce((select jsonb_agg(to_jsonb(months) order by m) from months), '[]'),
    'weekday', (
      select jsonb_agg(jsonb_build_object(
               'dow', d.dow,
               'visits', (select count(*) from att where session_id is not null and extract(isodow from at_local) = d.dow),
               'sessions', (select count(*) from held where extract(isodow from at_local) = d.dow))
             order by d.dow)
        from dows d),
    'heat', coalesce((
      select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'visits', n))
        from (select extract(isodow from at_local)::int dow, extract(hour from at_local)::int hr, count(*) n
                from att where session_id is not null group by 1, 2) h), '[]'),
    'groups', coalesce((
      select jsonb_agg(g order by g ->> 'title')
        from (
          select jsonb_build_object(
                   'title', sl.title,
                   'visits', (select count(*) from att a join public.training_slots s2 on s2.id = a.slot_id where s2.title = sl.title),
                   'sessions', (select count(*) from held h join public.training_slots s2 on s2.id = h.slot_id where s2.title = sl.title),
                   'capacity', (select coalesce(sum(h.capacity), 0) from held h join public.training_slots s2 on s2.id = h.slot_id where s2.title = sl.title)
                 ) g
            from (select distinct title from public.training_slots where active) sl
        ) x), '[]'),
    'mix', (
      select jsonb_build_object(
               'membership', coalesce(sum(amount_cents) filter (where kind = 'membership'), 0),
               'training',   coalesce(sum(amount_cents) filter (where kind in ('training', 'pack')), 0),
               'individual', coalesce(sum(amount_cents) filter (where kind = 'individual'), 0),
               'other',      coalesce(sum(amount_cents) filter (where kind not in ('membership', 'training', 'pack', 'individual')), 0),
               'app',        (select coalesce(sum(amount_cents), 0) from ap where paid_on >= v_from))
        from mp where paid_on >= v_from),
    'disciplines', coalesce((
      select jsonb_agg(jsonb_build_object('m', m, 'discipline', discipline, 'income', s) order by m, discipline)
        from (select date_trunc('month', paid_on)::date m, discipline, sum(amount_cents) s
                from mp where paid_on >= v_from group by 1, 2) d), '[]'),
    -- «От кого»: 10 учеников, принёсших больше всего (касса клуба + приложение)
    'top_payers', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'total', total, 'n', n) order by total desc)
        from (
          select coalesce(
                   (select trim(c.first_name || ' ' || coalesce(c.last_name, '')) from public.club_members c where c.id::text = x.who),
                   (select trim(p.first_name || ' ' || coalesce(p.last_name, '')) from public.profiles p where p.id::text = x.who),
                   '?') name,
                 sum(x.cents) total, count(*) n
            from (
              select member_id::text who, amount_cents cents from mp where paid_on >= v_from
              union all
              select case when member_id > 0 then member_id::text else athlete_id::text end, amount_cents
                from ap where paid_on >= v_from
            ) x
           group by x.who
           order by total desc
           limit 10
        ) t), '[]'),
    -- «Куда»: расходы по статьям за тот же период
    'expense_cats', coalesce((
      select jsonb_object_agg(category, s)
        from (select category, sum(amount_cents) s from public.club_expenses where spent_on >= v_from group by 1) e), '{}'),
    -- «Пропавшие»: платили минимум в 2 разных месяцах, последняя активность (оплата или посещение) 35+ дней назад, не ушли официально
    'lost', coalesce((
      select jsonb_agg(l order by l ->> 'last' desc)
        from (
          select jsonb_build_object(
                   'name', trim(m.first_name || ' ' || coalesce(m.last_name, '')),
                   'discipline', m.discipline,
                   'months', x.months,
                   'last', greatest(x.last_paid, (select max(at_local)::date from att where att.athlete_id = m.profile_id))) l
            from public.club_members m
            join (select member_id, count(distinct date_trunc('month', paid_on)) months, max(paid_on) last_paid
                    from mp where kind in ('membership', 'training', 'pack', 'individual')
                   group by member_id) x on x.member_id = m.id
           where m.status <> 'left' and m.cashbox_of is null and x.months >= 2
             and greatest(x.last_paid, (select max(at_local)::date from att where att.athlete_id = m.profile_id)) < v_today - 35
           order by greatest(x.last_paid, (select max(at_local)::date from att where att.athlete_id = m.profile_id)) desc
           limit 15
        ) y), '[]')
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.club_analytics() from public, anon;
grant execute on function public.club_analytics() to authenticated;

-- =====================================================================
-- DTT Club — Слой 51: исправления по итогам тестирования (ноябрь 2026).
--   1. request_trial: лимит не общий на всех (20/час), а на один адрес (IP) — 3 заявки в час;
--      общий потолок поднят до 100/час. IP хранится сутки, потом стирается.
--   2. check_in: двойное нажатие на QR — вместо технической ошибки «уже отмечено».
--   3. self_check_in: можно отметиться сам на двух разных тренировках за день
--      (например, MMA 17:00 и 19:00), но не больше двух в день и не дважды на одну.
--   4. payments.refunded_cents: частичный возврат через Stripe уменьшает доход в бюджете/аналитике.
-- Выполнить после layer50. Скрипт идемпотентный.
-- =====================================================================

-- ---------- 1. Заявки на пробную тренировку ----------
alter table public.trial_requests add column if not exists ip text;

create or replace function public.request_trial(
  p_name text, p_phone text, p_discipline text, p_age integer default null, p_preferred text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_name  text := left(trim(coalesce(p_name, '')), 80);
  -- Адрес отправителя: PostgREST передаёт заголовки запроса; первый в x-forwarded-for — клиент.
  v_ip    text := nullif(trim(split_part(coalesce(
               current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), '');
begin
  if length(v_phone) = 8 then
    v_phone := '371' || v_phone;           -- латвийский номер без кода
  end if;
  if v_phone !~ '^[0-9]{8,15}$' then
    raise exception 'Проверьте номер телефона' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'Укажите имя' using errcode = '22023';
  end if;
  if p_discipline not in ('mma', 'k1', 'grappling', 'kids') then
    raise exception 'Выберите направление' using errcode = '22023';
  end if;

  delete from public.trial_requests where created_at < now() - interval '180 days';
  update public.trial_requests set ip = null where ip is not null and created_at < now() - interval '1 day';

  -- Тот же номер за сутки — молча не дублируем
  if exists (select 1 from public.trial_requests
              where phone = v_phone and created_at > now() - interval '1 day') then
    return;
  end if;
  -- С одного адреса — не больше 3 заявок в час (спам не блокирует остальных)
  if v_ip is not null and (select count(*) from public.trial_requests
                            where ip = v_ip and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Слишком много заявок с этого устройства — позвоните или напишите тренеру в WhatsApp' using errcode = 'P0001';
  end if;
  if (select count(*) from public.trial_requests where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'Сейчас слишком много заявок — позвоните или напишите тренеру в WhatsApp' using errcode = 'P0001';
  end if;

  insert into public.trial_requests (name, phone, discipline, age, preferred, ip)
  values (v_name, v_phone, p_discipline,
          case when p_age between 4 and 90 then p_age end,
          nullif(left(trim(coalesce(p_preferred, '')), 200), ''),
          v_ip);
end;
$$;
revoke execute on function public.request_trial(text, text, text, integer, text) from public;
grant execute on function public.request_trial(text, text, text, integer, text) to anon, authenticated;

-- ---------- 2. QR: двойное нажатие ----------
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
  v_self    bigint;
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

  -- Два нажатия подряд (два запроса одновременно) — по очереди, второй увидит первую отметку.
  perform pg_advisory_xact_lock(hashtext('check-in:' || v_uid::text));

  if exists (select 1 from public.attendance where session_id = v_session and athlete_id = v_uid) then
    select p.trainings_count into v_count from public.profiles p where p.id = v_uid;
    return query select v_count, v_title, true;
    return;
  end if;

  -- Слой 42: сегодня уже отметился сам без тренировки — привязываем ту отметку к этому занятию.
  select a.id into v_self
    from public.attendance a
   where a.athlete_id = v_uid and a.method = 'self' and a.session_id is null
     and a.created_at >= (date_trunc('day', now() at time zone 'Europe/Riga') at time zone 'Europe/Riga')
   order by a.created_at desc limit 1;
  if v_self is not null then
    update public.attendance set session_id = v_session, method = 'qr' where id = v_self;
    select p.trainings_count into v_count from public.profiles p where p.id = v_uid;
    return query select v_count, v_title, true;
    return;
  end if;

  begin
    insert into public.attendance (athlete_id, marked_by, session_id, method)
    values (v_uid, v_uid, v_session, 'qr');
  exception when unique_violation then
    -- На всякий случай: отметка уже есть — это не ошибка для ученика.
    select p.trainings_count into v_count from public.profiles p where p.id = v_uid;
    return query select v_count, v_title, true;
    return;
  end;

  update public.profiles set trainings_count = trainings_count + 1
   where id = v_uid
  returning trainings_count into v_count;

  return query select v_count, v_title, false;
end;
$$;

-- ---------- 3. Самоотметка: две разные тренировки в день ----------
create or replace function public.self_check_in(p_group text default null)
returns table (trainings integer, already boolean, session_title text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_prof    record;
  v_day     timestamptz := (date_trunc('day', now() at time zone 'Europe/Riga') at time zone 'Europe/Riga');
  v_session bigint;
  v_title   text;
  v_count   integer;
  v_today   integer;
  v_group   text := nullif(regexp_replace(coalesce(p_group, ''), '[^a-z0-9-]', '', 'g'), '');  -- без % и _ из адреса
begin
  if v_uid is null then
    raise exception 'Войдите в приложение, чтобы отметиться' using errcode = '42501';
  end if;
  select id, approved_at, discipline, cross_training, trainings_count into v_prof from public.profiles where id = v_uid;
  if v_prof.id is null then
    raise exception 'Профиль не найден';
  end if;
  if v_prof.approved_at is null then
    raise exception 'Тренер ещё не подтвердил ваш аккаунт — пока отмечает он.';
  end if;

  perform pg_advisory_xact_lock(hashtext('self-checkin:' || v_uid::text));

  select count(*) into v_today from public.attendance where athlete_id = v_uid and created_at >= v_day;

  -- Ближайшая подходящая тренировка, на которой он ещё не отмечен
  select ts.id, s.title into v_session, v_title
    from public.training_sessions ts
    join public.training_slots s on s.id = ts.slot_id
   where not ts.cancelled
     and now() between ts.starts_at - interval '1 hour' and ts.ends_at + interval '3 hours'
     and not exists (select 1 from public.attendance a where a.session_id = ts.id and a.athlete_id = v_uid)
     and (
       (v_group is not null and s.id like v_group || '-%')
       or (v_group is null and (v_prof.discipline is null or coalesce(v_prof.cross_training, false)
            or s.discipline = v_prof.discipline or v_prof.discipline = 'both' or s.discipline = 'both'))
     )
   order by abs(extract(epoch from (ts.starts_at - now())))
   limit 1;

  -- Уже отмечен (на всех подходящих тренировках сейчас или два раза за сегодня) — не ошибка
  if v_today >= 2 or (v_session is null and v_today > 0) then
    return query select v_prof.trainings_count, true, null::text;
    return;
  end if;

  if v_session is null then
    raise exception 'Отметиться самому можно только в день тренировки: с часа до начала и до 3 часов после конца.';
  end if;

  insert into public.attendance (athlete_id, marked_by, session_id, method)
  values (v_uid, v_uid, v_session, 'self');

  update public.profiles set trainings_count = trainings_count + 1
   where id = v_uid
  returning trainings_count into v_count;

  return query select v_count, false, v_title;
end;
$$;

-- ---------- 4. Частичные возвраты Stripe ----------
alter table public.payments add column if not exists refunded_cents integer not null default 0
  check (refunded_cents >= 0);

-- Бюджет: доход приложения = оплачено минус частично возвращённое (полный возврат = status 'refunded').
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
  ap as (select date_trunc('month', created_at at time zone 'Europe/Riga')::date m, sum(amount_cents - refunded_cents)::int s
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

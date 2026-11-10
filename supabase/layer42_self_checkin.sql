-- =====================================================================
-- DTT Club — Слой 42: ученик сам отмечается на тренировке — не чаще 1 раза в день.
-- • Только подтверждённый тренером аккаунт.
-- • Если сегодня уже есть любая отметка (тренер, QR или сам) — второй раз не считается.
-- • Отметка привязывается к сегодняшнему занятию своего направления, если оно идёт
--   (за час до начала … два часа после конца); иначе — просто «был на тренировке».
-- • method = 'self' — тренер видит, что отметился сам, и может отменить
--   (undo_attendance, как и раньше).
-- Скрипт идемпотентный.
-- =====================================================================

alter table public.attendance drop constraint if exists attendance_method_check;
alter table public.attendance add constraint attendance_method_check check (method in ('coach', 'qr', 'self'));

create or replace function public.self_check_in()
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
begin
  if v_uid is null then
    raise exception 'Войдите в приложение, чтобы отметиться' using errcode = '42501';
  end if;
  select id, approved_at, discipline, trainings_count into v_prof from public.profiles where id = v_uid;
  if v_prof.id is null then
    raise exception 'Профиль не найден';
  end if;
  if v_prof.approved_at is null then
    raise exception 'Тренер ещё не подтвердил ваш аккаунт — пока отмечает он.';
  end if;

  -- Двойное нажатие не создаст две отметки.
  perform pg_advisory_xact_lock(hashtext('self-checkin:' || v_uid::text));

  if exists (select 1 from public.attendance where athlete_id = v_uid and created_at >= v_day) then
    return query select v_prof.trainings_count, true, null::text;
    return;
  end if;

  select ts.id, s.title into v_session, v_title
    from public.training_sessions ts
    join public.training_slots s on s.id = ts.slot_id
   where not ts.cancelled
     and now() between ts.starts_at - interval '1 hour' and ts.ends_at + interval '2 hours'
     and (v_prof.discipline is null or s.discipline = v_prof.discipline or v_prof.discipline = 'both' or s.discipline = 'both')
   order by abs(extract(epoch from (ts.starts_at - now())))
   limit 1;

  insert into public.attendance (athlete_id, marked_by, session_id, method)
  values (v_uid, v_uid, v_session, 'self');

  update public.profiles set trainings_count = trainings_count + 1
   where id = v_uid
  returning trainings_count into v_count;

  return query select v_count, false, v_title;
end;
$$;
revoke execute on function public.self_check_in() from public, anon;
grant execute on function public.self_check_in() to authenticated;

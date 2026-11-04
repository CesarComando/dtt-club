-- =====================================================================
-- DTT Club — Слой 4: CRM тренера (посещаемость).
-- Выполнить ПОСЛЕ schema.sql. Скрипт идемпотентный.
--
-- Почему через функции, а не прямой UPDATE:
-- колонку trainings_count никому из клиентов менять нельзя (см. schema.sql),
-- иначе спортсмен мог бы накрутить себе ранг. Тренер меняет её только через
-- функции ниже, которые сами проверяют, что вызывающий — admin.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Журнал посещений (кто, когда, кто отметил)
-- ---------------------------------------------------------------------
create table if not exists public.attendance (
  id         bigint generated always as identity primary key,
  athlete_id uuid        not null references public.profiles (id) on delete cascade,
  marked_by  uuid        references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists attendance_athlete_created_idx
  on public.attendance (athlete_id, created_at desc);

alter table public.attendance enable row level security;

revoke all on public.attendance from anon, authenticated;
grant select on public.attendance to authenticated;

-- Читать: свои посещения — спортсмен, все — тренер. Писать — только через функции.
drop policy if exists "attendance: own or coach can read" on public.attendance;
create policy "attendance: own or coach can read"
  on public.attendance for select
  to authenticated
  using (athlete_id = (select auth.uid()) or (select public.is_admin()));


-- ---------------------------------------------------------------------
-- 2. +1 тренировка (только тренер). Возвращает новое значение счётчика.
-- ---------------------------------------------------------------------
create or replace function public.mark_attendance(p_athlete uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Только тренер может отмечать посещаемость' using errcode = '42501';
  end if;

  update public.profiles
     set trainings_count = trainings_count + 1
   where id = p_athlete
  returning trainings_count into v_count;

  if v_count is null then
    raise exception 'Спортсмен не найден';
  end if;

  insert into public.attendance (athlete_id, marked_by) values (p_athlete, auth.uid());
  return v_count;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. Отмена ошибочной отметки (только тренер, только за сегодня по Риге)
-- ---------------------------------------------------------------------
create or replace function public.undo_attendance(p_athlete uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    bigint;
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Только тренер может отменять отметки' using errcode = '42501';
  end if;

  select id into v_id
    from public.attendance
   where athlete_id = p_athlete
     and created_at >= (date_trunc('day', now() at time zone 'Europe/Riga') at time zone 'Europe/Riga')
   order by created_at desc
   limit 1;

  if v_id is null then
    raise exception 'Сегодня отметок нет — отменять нечего';
  end if;

  delete from public.attendance where id = v_id;

  update public.profiles
     set trainings_count = greatest(trainings_count - 1, 0)
   where id = p_athlete
  returning trainings_count into v_count;

  return v_count;
end;
$$;


-- Функции по умолчанию доступны PUBLIC — оставляем только вошедшим
-- (внутри всё равно проверка is_admin()).
revoke execute on function public.mark_attendance(uuid), public.undo_attendance(uuid) from public, anon;
grant  execute on function public.mark_attendance(uuid), public.undo_attendance(uuid) to authenticated;

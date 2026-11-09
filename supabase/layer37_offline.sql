-- =====================================================================
-- DTT Club — Слой 37: отметки тренера без интернета.
-- Выполнить ПОСЛЕ layer20_staff.sql. Скрипт идемпотентный.
--
-- Приложение тренера складывает «+1» в очередь на телефоне и отправляет,
-- когда появится сеть. mark_attendance_at() записывает отметку временем нажатия
-- (а не временем отправки), а client_id не даёт задвоить отметку при повторной отправке.
-- =====================================================================

alter table public.attendance add column if not exists client_id uuid;
create unique index if not exists attendance_client_id_key on public.attendance (client_id) where client_id is not null;

create or replace function public.mark_attendance_at(p_athlete uuid, p_at timestamptz, p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_at    timestamptz := p_at;
begin
  if not public.is_staff() then
    raise exception 'Только тренер может отмечать посещаемость' using errcode = '42501';
  end if;

  -- Уже пришла раньше (повтор после обрыва связи) — второй раз не считаем.
  if p_client_id is not null and exists (select 1 from public.attendance where client_id = p_client_id) then
    select trainings_count into v_count from public.profiles where id = p_athlete;
    return v_count;
  end if;

  -- Время нажатия: не из будущего и не старше 7 дней (иначе — «сейчас»).
  if v_at is null or v_at > now() + interval '5 minutes' or v_at < now() - interval '7 days' then
    v_at := now();
  end if;

  update public.profiles
     set trainings_count = trainings_count + 1
   where id = p_athlete
  returning trainings_count into v_count;

  if v_count is null then
    raise exception 'Спортсмен не найден';
  end if;

  insert into public.attendance (athlete_id, marked_by, created_at, client_id)
  values (p_athlete, auth.uid(), v_at, p_client_id);
  return v_count;
end;
$$;
revoke execute on function public.mark_attendance_at(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.mark_attendance_at(uuid, timestamptz, uuid) to authenticated;

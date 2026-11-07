-- =====================================================================
-- DTT Club — Слой 31: «Кто идёт» на тренировку.
-- Выполнить ПОСЛЕ layer29_friends.sql. Скрипт идемпотентный.
--
-- session_attendees(ids): для ближайших занятий — кто записан.
--   * Имя и фото — только у учеников, которые НЕ скрыли профиль (hide_profile).
--     Скрытые и детские аккаунты (parent_id) не называются, но учитываются
--     в hidden_count, чтобы «ещё N» сходилось со счётчиком мест.
--   * id записанных возвращается, чтобы «Позвать друга» показывал «✓ Идёт»
--     вместо кнопки. Для скрытых и детей id не отдаётся.
--   * Только будущие, не отменённые занятия. Телефоны и прочее — нет.
-- =====================================================================

create or replace function public.session_attendees(p_sessions bigint[])
returns table (
  session_id   bigint,
  athlete_id   uuid,      -- null для строки-итога по скрытым
  first_name   text,
  last_name    text,
  avatar_url   text,
  hidden_count integer    -- только в строке-итоге (athlete_id is null)
)
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select bk.session_id, p.id, p.first_name, p.last_name, p.avatar_url,
           (p.hide_profile or p.parent_id is not null) as hid, bk.created_at
      from public.bookings bk
      join public.training_sessions ts on ts.id = bk.session_id
      join public.profiles p on p.id = bk.athlete_id
     where (select auth.uid()) is not null
       and bk.session_id = any (p_sessions)
       and not ts.cancelled
       and ts.ends_at > now()
  )
  select session_id, id, first_name, last_name, avatar_url, null::integer
    from b where not hid
  union all
  select session_id, null, null, null, null, count(*)::integer
    from b where hid group by session_id
  order by 1, 3 nulls last, 4;
$$;
revoke execute on function public.session_attendees(bigint[]) from public, anon;
grant execute on function public.session_attendees(bigint[]) to authenticated;

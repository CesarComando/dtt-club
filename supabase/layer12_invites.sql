-- =====================================================================
-- DTT Club — Слой 12: «Позвать друга на тренировку».
-- Выполнить ПОСЛЕ layer8_booking.sql. Скрипт идемпотентный.
--
-- Ученик берёт ссылку-приглашение на конкретное занятие и шлёт другу
-- (WhatsApp и т.п.). Друг открывает ссылку, видит, кто зовёт и когда,
-- регистрируется/входит и записывается одним нажатием — даже если это
-- не его направление. Тренер видит в CRM, кто кого привёл.
-- Одна ссылка на (ученик, занятие) — ей могут воспользоваться несколько друзей,
-- лимит мест занятия проверяется как при обычной записи.
-- =====================================================================

create table if not exists public.training_invites (
  token      text primary key,
  session_id bigint      not null references public.training_sessions (id) on delete cascade,
  inviter_id uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (session_id, inviter_id)
);

alter table public.training_invites enable row level security;
revoke all on public.training_invites from anon, authenticated;  -- только через функции

-- Кто привёл ученика на это занятие.
alter table public.bookings add column if not exists invited_by uuid
  references public.profiles (id) on delete set null;


-- Ученик: ссылка-приглашение на занятие (повторный вызов вернёт ту же).
create or replace function public.create_invite(p_session bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_token text;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.training_sessions
     where id = p_session and not cancelled and starts_at > now()
  ) then
    raise exception 'На это занятие уже нельзя позвать: оно прошло или отменено';
  end if;

  select token into v_token from public.training_invites
   where session_id = p_session and inviter_id = v_uid;
  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '');
    insert into public.training_invites (token, session_id, inviter_id)
    values (v_token, p_session, v_uid);
  end if;
  return v_token;
end;
$$;


-- Кто угодно (даже без входа): что за приглашение. Отдаём только имя
-- пригласившего и данные занятия — без фамилии, телефона, фото.
create or replace function public.invite_info(p_token text)
returns table (
  session_id    bigint,
  title         text,
  discipline    text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  venue_name    text,
  venue_address text,
  capacity      integer,
  booked        integer,
  cancelled     boolean,
  inviter_name  text,
  is_mine       boolean,
  is_booked     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select ts.id, s.title, s.discipline, ts.starts_at, ts.ends_at, v.name, v.address, ts.capacity,
         (select count(*)::integer from public.bookings b where b.session_id = ts.id),
         ts.cancelled,
         p.first_name,
         i.inviter_id = auth.uid(),
         exists (select 1 from public.bookings b where b.session_id = ts.id and b.athlete_id = auth.uid())
    from public.training_invites i
    join public.training_sessions ts on ts.id = i.session_id
    join public.training_slots  s on s.id = ts.slot_id
    join public.training_venues v on v.id = ts.venue_id
    join public.profiles p on p.id = i.inviter_id
   where i.token = p_token;
$$;


-- Друг: записаться по приглашению. Направление не проверяем — его позвали.
create or replace function public.accept_invite(p_token text)
returns integer   -- сколько человек записано после записи
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_invite  public.training_invites%rowtype;
  v_session public.training_sessions%rowtype;
  v_booked  integer;
begin
  if v_uid is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;

  select * into v_invite from public.training_invites where token = p_token;
  if not found then
    raise exception 'Приглашение не найдено';
  end if;
  if v_invite.inviter_id = v_uid then
    raise exception 'Это ваше приглашение — отправьте ссылку другу';
  end if;

  select * into v_session from public.training_sessions where id = v_invite.session_id for update;
  if v_session.cancelled then
    raise exception 'Это занятие отменено';
  end if;
  if v_session.starts_at <= now() then
    raise exception 'Запись закрыта: тренировка уже началась';
  end if;
  if exists (select 1 from public.bookings where session_id = v_session.id and athlete_id = v_uid) then
    raise exception 'Вы уже записаны';
  end if;

  select count(*) into v_booked from public.bookings where session_id = v_session.id;
  if v_session.capacity is not null and v_booked >= v_session.capacity then
    raise exception 'Мест нет: записано % из %', v_booked, v_session.capacity using errcode = 'P0001';
  end if;

  insert into public.bookings (session_id, athlete_id, invited_by)
  values (v_session.id, v_uid, v_invite.inviter_id);
  return v_booked + 1;
end;
$$;


revoke execute on function
  public.create_invite(bigint),
  public.invite_info(text),
  public.accept_invite(text)
from public, anon;
grant execute on function public.create_invite(bigint), public.accept_invite(text) to authenticated;
grant execute on function public.invite_info(text) to anon, authenticated;

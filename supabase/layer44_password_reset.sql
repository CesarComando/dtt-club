-- =====================================================================
-- DTT Club — Слой 44: восстановление пароля.
-- 1. reset_member_password(user) — главный тренер ставит ученику временный пароль
--    (dtt + 6 цифр), видит его один раз и передаёт лично. Аккаунт главного тренера так не сбрасывается.
-- 2. password_reset_codes — одноразовые SMS-коды для «Забыли пароль?» (Edge Function password-reset).
--    Доступ только у сервера (service_role): RLS включён, политик нет.
-- Смена своего пароля в Кабинете — штатно через supabase.auth.updateUser, SQL не нужен.
-- Скрипт идемпотентный.
-- =====================================================================

create or replace function public.reset_member_password(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pw   text;
  v_role text;
begin
  if not public.is_admin() then
    raise exception 'Только для главного тренера' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = p_user;
  if v_role is null then
    raise exception 'Аккаунт не найден';
  end if;
  if v_role = 'admin' then
    raise exception 'Пароль главного тренера так не сбрасывается';
  end if;
  -- 6 случайных цифр без 0 и 1 (чтобы не путать с O и l).
  select 'dtt' || string_agg(substr('23456789', 1 + (get_byte(b, i) % 8), 1), '')
    into v_pw
    from (select extensions.gen_random_bytes(6) as b) r, generate_series(0, 5) as i;
  update auth.users
     set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = p_user;
  return v_pw;
end;
$$;
revoke execute on function public.reset_member_password(uuid) from public, anon;
grant execute on function public.reset_member_password(uuid) to authenticated;

create table if not exists public.password_reset_codes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  phone      text not null,
  code_hash  text not null,
  attempts   smallint not null default 0,
  ip         text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_codes_phone on public.password_reset_codes (phone, created_at desc);
create index if not exists password_reset_codes_ip on public.password_reset_codes (ip, created_at desc);
alter table public.password_reset_codes enable row level security;
revoke all on public.password_reset_codes from anon, authenticated;

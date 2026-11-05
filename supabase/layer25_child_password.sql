-- =====================================================================
-- DTT Club — Слой 25: родитель задаёт ребёнку новый пароль (если ребёнок забыл).
-- Выполнить ПОСЛЕ layer24_kids.sql. Скрипт идемпотентный.
--
-- Можно только своему ребёнку (profiles.parent_id = вы); главный тренер — любому ученику.
-- Пароль хэшируется bcrypt (как в Supabase Auth); после смены ребёнок входит с новым паролем.
-- =====================================================================

create or replace function public.reset_child_password(p_child uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Пароль слишком короткий (минимум 6 символов)' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles c
     where c.id = p_child
       and (c.parent_id = auth.uid() or (public.is_admin() and c.role <> 'admin'))
  ) then
    raise exception 'Можно менять пароль только своему ребёнку' using errcode = '42501';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_child;
end;
$$;

revoke execute on function public.reset_child_password(uuid, text) from public, anon;
grant execute on function public.reset_child_password(uuid, text) to authenticated;

-- Родитель видит логин своего ребёнка (у ребёнка «телефон» = логин «телефон родителя-номер»).
drop policy if exists "contacts: parent reads child login" on public.profile_contacts;
create policy "contacts: parent reads child login" on public.profile_contacts
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_contacts.id and p.parent_id = (select auth.uid())));

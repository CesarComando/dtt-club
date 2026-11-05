-- =====================================================================
-- DTT Club — Слой 21: укрепление по итогам проверки. Идемпотентный.
--
-- 1. Служебные функции нельзя вызывать из приложения напрямую.
--    Supabase по умолчанию даёт authenticated право EXECUTE на новые функции,
--    поэтому «revoke … from public, anon» его не снимал. Триггерные функции
--    и помощники вызываются только изнутри базы (триггеры и security definer
--    функции), им EXECUTE для пользователей не нужен.
-- 2. Профиль помощника тренера (role = 'coach') не виден обычным ученикам:
--    его нет в списках, и по роли его нельзя вычислить. Видят только он сам,
--    тренер и помощники.
-- =====================================================================

revoke execute on function
  public.handle_new_user(),
  public.auto_link_member(),
  public.gallery_items_set_status(),
  public.training_slots_sync(),
  public.ensure_sessions(integer),
  public.session_capacity(text, text)
from anon, authenticated;   -- системные роли (auth и т.п.) не трогаем

drop policy if exists "profiles: authenticated can read all" on public.profiles;
create policy "profiles: authenticated can read all" on public.profiles
  for select to authenticated
  using (role <> 'coach' or id = (select auth.uid()) or (select public.is_staff()));

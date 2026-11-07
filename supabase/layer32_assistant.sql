-- =====================================================================
-- DTT Club — Слой 32: ИИ-помощник «Спросить» (Claude).
-- Выполнить в Supabase → SQL Editor. Скрипт идемпотентный.
--
-- club_info        — тексты, на которые опирается помощник (ключ 'facts').
--                    Читают все вошедшие, меняет только тренер (вкладка «Помощник»).
-- assistant_usage  — счётчик вопросов в день на человека (лимит в Edge Function).
--                    Доступ только у сервера (service_role).
-- Сам вызов Claude — Edge Function ask-club (ключ ANTHROPIC_API_KEY в секретах).
-- =====================================================================

create table if not exists public.club_info (
  key        text primary key,
  body       text        not null default '',
  updated_at timestamptz not null default now()
);
alter table public.club_info enable row level security;

drop policy if exists "club_info: read" on public.club_info;
create policy "club_info: read" on public.club_info
  for select to authenticated using (true);
drop policy if exists "club_info: coach writes" on public.club_info;
create policy "club_info: coach writes" on public.club_info
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
grant select, insert, update on public.club_info to authenticated;

insert into public.club_info (key, body) values ('facts', $facts$
Клубы: Daugavpils Top Team (MMA, K1, детское MMA; с 2023) и Daugavpils Grappling Team (грэпплинг / BJJ no-gi; с 2011). Тренер обоих клубов — Dainis Miglāns (тренер MMA категории C, UWW Grappling категории B, спортивный педагог DU 2026).

Первая тренировка — бесплатно.
Абонемент действует только в своей секции; в другой секции — разовая оплата.
Оплата: в приложении (карта) или переводом на счёт. Переводы тренер вносит в приложение сам, после этого видно, до какого числа действует абонемент.
Индивидуальная тренировка 1,5–2 часа — 25 €.

Возраст: взрослые группы 18–45 лет, детская группа — 5–8 класс.
Что взять: удобная спортивная одежда, вода, полотенце. Для грэпплинга кимоно не нужно (no-gi). Про защиту для MMA — спросить тренера.
В зале есть раздевалки и душ.
Спарринги добровольные; если участвуешь — контроль обязателен.
Перед первой тренировкой подписываются правила клуба, за ребёнка — родитель.
Новичкам в MMA — группа «новички» (пн, ср, пт 17:00).

Достижения: Danila Ančipanovs — чемпион Латвии по панкратиону 2023, серебро чемпионата Латвии по MMA 2026; Viktors Leonovs — чемпион Латвии по MMA 2024 и 2026, бронза 2025; Artūrs Akula — бронза чемпионата Латвии по грэпплингу 2024.

Контакты: телефон и WhatsApp +371 27 167 013; сайт daugavpilstopteam.lv; Instagram @daugavpils_top_team_mma и @daugavpils_grappling_team; TikTok и YouTube @daugavpilstopteam.
$facts$)
on conflict (key) do nothing;

create table if not exists public.assistant_usage (
  user_id uuid    not null references public.profiles (id) on delete cascade,
  day     date    not null,
  count   integer not null default 0,
  primary key (user_id, day)
);
alter table public.assistant_usage enable row level security;
-- политик нет: читать и писать может только service_role (Edge Function)
revoke all on public.assistant_usage from anon, authenticated;

-- Атомарно +1 к счётчику и вернуть новое значение (вызывает только сервер).
create or replace function public.assistant_bump(p_user uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.assistant_usage (user_id, day, count)
  values (p_user, (now() at time zone 'Europe/Riga')::date, 1)
  on conflict (user_id, day) do update set count = public.assistant_usage.count + 1
  returning count;
$$;
revoke execute on function public.assistant_bump(uuid) from public, anon, authenticated;

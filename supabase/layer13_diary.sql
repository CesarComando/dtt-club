-- =====================================================================
-- DTT Club — Слой 13: параметры тела (ИМТ), словарь приёмов, мои приёмы,
-- дневник тренировок. (Оценки партнёров — layer14_peer_ratings.sql.)
-- Выполнить ПОСЛЕ layer12_invites.sql. Скрипт идемпотентный.
--
-- Рост / вес / дата рождения — НЕ в profiles: profiles читают все вошедшие
-- (имена и ранги видны в клубе), а это личные данные, в т.ч. детей.
-- Поэтому — отдельная таблица profile_body (как profile_contacts для телефонов):
-- видят только сам ученик и тренер.
-- Все таблицы ссылаются на profiles с on delete cascade — удаление аккаунта
-- (Edge Function delete-account) стирает и эти данные.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Параметры тела (1:1 с profiles)
-- ---------------------------------------------------------------------
create table if not exists public.profile_body (
  id         uuid primary key references public.profiles (id) on delete cascade,
  height     integer      check (height is null or height between 80 and 230),         -- см
  weight     numeric(5,1) check (weight is null or weight between 15 and 250),         -- кг
  birth_date date         check (birth_date is null or birth_date between '1920-01-01' and current_date),
  updated_at timestamptz  not null default now()
);

alter table public.profile_body enable row level security;
revoke all on public.profile_body from anon, authenticated;
grant select, insert, update, delete on public.profile_body to authenticated;

drop policy if exists "body: own or coach read" on public.profile_body;
create policy "body: own or coach read" on public.profile_body
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "body: own write" on public.profile_body;
create policy "body: own write" on public.profile_body
  for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));


-- ---------------------------------------------------------------------
-- 2. Словарь приёмов (читают все вошедшие, правит тренер)
-- ---------------------------------------------------------------------
create table if not exists public.techniques_dictionary (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  category   text not null,
  discipline text not null default 'grappling' check (discipline in ('grappling', 'mma', 'both'))
);

alter table public.techniques_dictionary enable row level security;
revoke all on public.techniques_dictionary from anon, authenticated;
grant select, insert, update, delete on public.techniques_dictionary to authenticated;

drop policy if exists "techniques: authenticated read" on public.techniques_dictionary;
create policy "techniques: authenticated read" on public.techniques_dictionary
  for select to authenticated using (true);
drop policy if exists "techniques: coach manages" on public.techniques_dictionary;
create policy "techniques: coach manages" on public.techniques_dictionary
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Стартовый список. Тренер дополняет его сам (SQL / Dashboard).
insert into public.techniques_dictionary (name, category, discipline) values
  -- Тейкдауны и броски
  ('Проход в две ноги (double leg)',     'Тейкдауны и броски', 'both'),
  ('Проход в одну ногу (single leg)',    'Тейкдауны и броски', 'both'),
  ('Подсечка изнутри (ouchi gari)',      'Тейкдауны и броски', 'both'),
  ('Отхват (osoto gari)',                'Тейкдауны и броски', 'both'),
  ('Бросок через бедро',                 'Тейкдауны и броски', 'both'),
  ('Подхват (uchi mata)',                'Тейкдауны и броски', 'grappling'),
  ('Переход за спину из стойки',         'Тейкдауны и броски', 'both'),
  ('Ankle pick',                         'Тейкдауны и броски', 'grappling'),
  ('Snap down',                          'Тейкдауны и броски', 'grappling'),
  -- Позиции и контроль
  ('Удержание сбоку (side control)',     'Позиции и контроль', 'both'),
  ('Маунт',                              'Позиции и контроль', 'both'),
  ('Колено на животе',                   'Позиции и контроль', 'both'),
  ('Контроль спины (крюки)',             'Позиции и контроль', 'both'),
  ('Север-юг',                           'Позиции и контроль', 'grappling'),
  ('Закрытый гард',                      'Позиции и контроль', 'both'),
  ('Баттерфляй-гард',                    'Позиции и контроль', 'grappling'),
  ('Полугард',                           'Позиции и контроль', 'both'),
  ('Де ла Рива',                         'Позиции и контроль', 'grappling'),
  -- Проходы гарда
  ('Проход тореадор',                    'Проходы гарда', 'grappling'),
  ('Проход через колено (knee slice)',   'Проходы гарда', 'grappling'),
  ('Проход с давлением (over-under)',    'Проходы гарда', 'grappling'),
  ('Проход полугарда',                   'Проходы гарда', 'both'),
  ('Лег-драг',                           'Проходы гарда', 'grappling'),
  -- Свипы
  ('Ножницы (scissor sweep)',            'Свипы', 'grappling'),
  ('Свип через бедро (hip bump)',        'Свипы', 'both'),
  ('Баттерфляй-свип',                    'Свипы', 'grappling'),
  ('Цветочный свип (flower sweep)',      'Свипы', 'grappling'),
  ('Свип из полугарда (old school)',     'Свипы', 'grappling'),
  -- Удушения
  ('Удушение сзади (rear naked choke)',  'Удушения', 'both'),
  ('Гильотина',                          'Удушения', 'both'),
  ('Треугольник ногами',                 'Удушения', 'both'),
  ('Д''Арс',                             'Удушения', 'both'),
  ('Анаконда',                           'Удушения', 'both'),
  ('Удушение руками (arm triangle)',     'Удушения', 'both'),
  ('Удушение из-за спины с воротом',     'Удушения', 'grappling'),
  -- Болевые
  ('Рычаг локтя (armbar)',               'Болевые', 'both'),
  ('Кимура',                             'Болевые', 'both'),
  ('Американа',                          'Болевые', 'both'),
  ('Омоплата',                           'Болевые', 'grappling'),
  ('Ахиллес (прямой ущемляющий)',        'Болевые', 'grappling'),
  ('Скручивание пятки (heel hook)',      'Болевые', 'grappling'),
  ('Рычаг колена (kneebar)',             'Болевые', 'grappling'),
  -- Выходы и защита
  ('Выход с моста (upa)',                'Выходы и защита', 'both'),
  ('Выход локоть-колено (shrimp)',       'Выходы и защита', 'both'),
  ('Защита от прохода в ноги (sprawl)',  'Выходы и защита', 'both'),
  ('Выход из удержания сбоку',           'Выходы и защита', 'both'),
  ('Защита спины',                       'Выходы и защита', 'both'),
  ('Вставание в стойку (technical stand-up)', 'Выходы и защита', 'both'),
  -- Ударная техника (MMA / K1)
  ('Джеб',                               'Ударная техника', 'mma'),
  ('Кросс',                              'Ударная техника', 'mma'),
  ('Боковой (хук)',                      'Ударная техника', 'mma'),
  ('Апперкот',                           'Ударная техника', 'mma'),
  ('Лоу-кик',                            'Ударная техника', 'mma'),
  ('Мидл-кик',                           'Ударная техника', 'mma'),
  ('Хай-кик',                            'Ударная техника', 'mma'),
  ('Удар коленом',                       'Ударная техника', 'mma'),
  ('Прямой удар ногой (тип)',            'Ударная техника', 'mma'),
  ('Граунд-энд-паунд',                   'Ударная техника', 'mma'),
  ('Клинч и работа у сетки',             'Ударная техника', 'mma')
on conflict (name) do nothing;


-- ---------------------------------------------------------------------
-- 3. Мои приёмы: изучаю / освоил
-- ---------------------------------------------------------------------
create table if not exists public.user_learned_techniques (
  user_id      uuid   not null references public.profiles (id) on delete cascade,
  technique_id bigint not null references public.techniques_dictionary (id) on delete cascade,
  status       text   not null check (status in ('learning', 'mastered')),
  updated_at   timestamptz not null default now(),
  primary key (user_id, technique_id)
);

alter table public.user_learned_techniques enable row level security;
revoke all on public.user_learned_techniques from anon, authenticated;
grant select, insert, update, delete on public.user_learned_techniques to authenticated;

drop policy if exists "learned: own or coach read" on public.user_learned_techniques;
create policy "learned: own or coach read" on public.user_learned_techniques
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "learned: own write" on public.user_learned_techniques;
create policy "learned: own write" on public.user_learned_techniques
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- ---------------------------------------------------------------------
-- 4. Дневник тренировок (видят сам ученик и тренер)
-- ---------------------------------------------------------------------
create table if not exists public.training_diary (
  id                 bigint generated always as identity primary key,
  user_id            uuid   not null default auth.uid() references public.profiles (id) on delete cascade,
  date               date   not null default current_date,
  notes              text   not null default '' check (length(notes) <= 4000),
  applied_techniques text[] not null default '{}' check (cardinality(applied_techniques) <= 30),
  created_at         timestamptz not null default now()
);
create index if not exists training_diary_user_date_idx on public.training_diary (user_id, date desc);

alter table public.training_diary enable row level security;
revoke all on public.training_diary from anon, authenticated;
grant select, insert, update, delete on public.training_diary to authenticated;

drop policy if exists "diary: own or coach read" on public.training_diary;
create policy "diary: own or coach read" on public.training_diary
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "diary: own write" on public.training_diary;
create policy "diary: own write" on public.training_diary
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- ---------------------------------------------------------------------
-- 5. Оценки партнёров — см. layer14_peer_ratings.sql (7 критериев).
-- ---------------------------------------------------------------------

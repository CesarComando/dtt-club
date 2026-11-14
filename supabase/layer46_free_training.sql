-- Слой 46: бесплатные тренировки (по решению главного тренера).
-- club_members.free_training = true — человек не попадает в список должников.
-- Первый такой: Artjoms Bobrovs (сын тренера Андрея Боброва, помогает на тренировках).
alter table public.club_members add column if not exists free_training boolean not null default false;
comment on column public.club_members.free_training is 'Тренируется бесплатно (по решению главного тренера) — не попадает в должники';
-- payment_debtors(): добавлено условие
--   and not exists (select 1 from free_users fu where fu.user_id = pf.id)
-- где free_users = club_members с profile_id и free_training = true.
-- Полный текст функции применён миграцией layer46_free_training в Supabase.

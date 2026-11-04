-- =====================================================================
-- DTT Club — подготовка к будущим фичам (подписка, трекинг веса).
-- Выполнить ПОСЛЕ layer5_ranks.sql. Скрипт идемпотентный.
-- =====================================================================

-- Подписка «Поддержать клуб». Ставится только тренером / будущей оплатой,
-- спортсмен сам не может её включить (update-права на эту колонку не выдаются).
alter table public.profiles add column if not exists is_sponsor boolean not null default false;

-- Текущий вес, кг (для будущего трекинга веса). NULL = не указан.
alter table public.profiles add column if not exists current_weight numeric(5, 1);
alter table public.profiles drop constraint if exists profiles_current_weight_check;
alter table public.profiles add constraint profiles_current_weight_check
  check (current_weight is null or current_weight between 20 and 250);

-- Права на изменение current_weight спортсмену выдадим в спринте «Трекинг веса»:
--   grant update (current_weight) on public.profiles to authenticated;

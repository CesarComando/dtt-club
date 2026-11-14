-- =====================================================================
-- DTT Club — Слой 44: темы статей (болевые на ноги / на руки / удушения /
-- контроль / общее). Выполнить ПОСЛЕ layer43. Скрипт идемпотентный.
-- Тема необязательна: у новостей и интервью она пустая.
-- =====================================================================

alter table public.articles add column if not exists topic text;

alter table public.articles drop constraint if exists articles_topic_check;
alter table public.articles add constraint articles_topic_check
  check (topic is null or topic in ('legs', 'arms', 'chokes', 'control', 'general'));

-- Темы уже добавленных статей по БЖЖ (id 5–44).
update public.articles set topic = case
  when id in (5, 15, 22, 37, 38, 39, 40)       then 'legs'
  when id between 25 and 31                    then 'arms'
  when id in (9, 20, 32, 33, 34, 35, 36)       then 'chokes'
  when id in (7, 12, 19, 21, 41, 42, 43, 44)   then 'general'
  else 'control'
end
where id between 5 and 44 and category = 'article' and topic is null;

-- До слоя 44 тема временно стояла в начале заголовка («Удушения · …») —
-- теперь её показывают кнопки, приставку убираем.
update public.articles
set title = regexp_replace(title, '^(Болевые на ноги|Болевые на руки|Удушения|Контроль и позиции|Тренировки и восстановление) · ', '')
where id between 5 and 44 and topic is not null;

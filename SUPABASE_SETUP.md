# Настройка Supabase (Слой 3)

Пять шагов, ~10 минут. Всё делается в браузере на supabase.com.

## 1. Создать проект
1. Зайдите на https://supabase.com → **Start your project** → войдите (можно через GitHub).
2. **New project** → имя `dtt-club`, регион **Central EU (Frankfurt)** — ближе всего к Латвии.
3. Сохраните сгенерированный **Database Password** в менеджер паролей. В приложение он не нужен.
4. Подождите 1–2 минуты, пока проект создаётся.

## 2. Отключить подтверждение email ⚠️ обязательно
Мы входим по телефону, а email вида `37120000000@dtt.local` — технический, письма на него не дойдут.

**Authentication → Sign In / Providers → Email** → выключите **Confirm email** → **Save**.

Без этого регистрация создаст пользователя, но не выдаст сессию, и селфи не загрузится.

## 3. Выполнить SQL-скрипт
**SQL Editor → New query** → вставьте всё содержимое файла [`supabase/schema.sql`](supabase/schema.sql) → **Run**.

Скрипт создаёт:
- таблицу `profiles` + RLS (читают все вошедшие, меняют только своё; `trainings_count` и `role` спортсмену менять нельзя);
- таблицу `profile_contacts` с телефонами — их видит только сам спортсмен и тренер (`role = 'admin'`);
- триггер `on_auth_user_created` — профиль создаётся сам при регистрации;
- **приватный бакет `avatars`** (до 2 МБ, только jpeg/png/webp) и политики доступа к нему.

Затем так же по очереди выполните [`supabase/layer4_crm.sql`](supabase/layer4_crm.sql) (посещаемость) и [`supabase/layer5_ranks.sql`](supabase/layer5_ranks.sql) (направление и ручной ранг).

Проверка: **Table Editor** → появилась таблица `profiles`; **Storage** → появился бакет `avatars` (с замком — private).

### Если хотите создать бакет вручную, а не через SQL
**Storage → New bucket** → Name: `avatars` → **Public bucket: выключено** → Additional configuration: File size limit `2 MB`, Allowed MIME types `image/jpeg, image/png, image/webp` → **Create**.
Политики доступа всё равно возьмите из раздела 4 скрипта (SQL Editor) — через SQL надёжнее, чем кликать мышкой.

## 4. Скопировать ключи в `.env`
**Project Settings → API Keys** (или кнопка **Connect** вверху проекта):
- **Project URL** → `https://xxxx.supabase.co`
- **anon / publishable key** (длинная строка `eyJ…` или `sb_publishable_…`)

Откройте `.env` в корне проекта и вставьте:
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```
❌ **Никогда** не вставляйте ключ `service_role` / `secret` — он обходит всю защиту RLS.

Перезапустите `npm run dev` (Vite читает `.env` только при старте).

## 5. Проверить
1. Откройте `http://localhost:5173/#/register`, сделайте селфи, заполните форму.
2. В Supabase: **Authentication → Users** — новый пользователь; **Table Editor → profiles** — строка с именем и `avatar_url`; **Storage → avatars** — папка с `selfie.jpg`.
3. Выйдите/обновите страницу → `#/login` → вход по телефону и паролю.

## Потом: назначить тренера админом
Когда Dainis зарегистрируется, выполните в SQL Editor:
```sql
update public.profiles set role = 'admin'
where id = (select id from public.profile_contacts where phone = '371XXXXXXXX');
```

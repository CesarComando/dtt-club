# Резервная копия базы

База Supabase проекта **dtt-club** общая для клуба и крепости. На бесплатном тарифе Supabase сам копий не делает,
поэтому копию делает GitHub: каждую ночь (`.github/workflows/backup.yml`), бесплатно.

- Что входит: вся база (таблицы, данные, правила доступа, функции, роли).
- Что **не** входит: файлы в Storage (фото галереи, аватары). Их копия — отдельная задача.
- Где лежит: GitHub → вкладка **Actions** → «Резервная копия базы» → нужный запуск → **Artifacts**. Хранится 30 дней.
- Копия зашифрована паролем. Репозиторий публичный — без пароля файл бесполезен.

## Настроить (один раз, 5 минут)

GitHub → репозиторий dtt-club → **Settings → Secrets and variables → Actions → New repository secret**:

1. `SUPABASE_DB_URL` — адрес базы с паролем. Supabase → проект dtt-club → кнопка **Connect** →
   **Session pooler** → строка вида `postgresql://postgres.latnwksisoziluhdadgy:[ПАРОЛЬ]@aws-…pooler.supabase.com:5432/postgres` (скопируйте как есть),
   вместо `[ПАРОЛЬ]` — пароль базы (Settings → Database; если не помните — там же «Reset database password»).
   Нужен именно Session pooler: прямой адрес `db.…supabase.co` с серверов GitHub недоступен.
2. `BACKUP_PASSPHRASE` — длинная фраза для шифрования (например, 5–6 случайных слов).
   **Запишите её туда, где не потеряете** (менеджер паролей, бумага в сейфе). Без неё копию не открыть.
3. По желанию `PODVORYE_DB_URL` — так же для проекта podvorye; тогда будет копия и подворья.

Проверка: Actions → «Резервная копия базы» → **Run workflow**. Через пару минут появится зелёная галочка и файл в Artifacts.

> GitHub отключает ночные запуски в репозитории, где 60 дней не было изменений, и пишет об этом письмом.
> Если пришло такое письмо — нажмите «Enable workflow» во вкладке Actions.

## Восстановить

```bash
gpg -d club-2026-11-23.tar.gz.gpg > club.tar.gz     # спросит пароль BACKUP_PASSPHRASE
mkdir club && tar xzf club.tar.gz -C club
# В НОВЫЙ пустой проект Supabase (адрес Session pooler нового проекта):
psql "$NEW_DB_URL" -f club/roles.sql
psql "$NEW_DB_URL" -f club/schema.sql
psql "$NEW_DB_URL" -c "SET session_replication_role = replica" -f club/data.sql
```

Восстанавливать поверх рабочей базы нельзя — только в новый проект, потом переключить приложение на него.

# Деплой на GitHub Pages → app.daugavpilstopteam.lv

> **С ноября 2026 код и сайт разделены.**
> - `CesarComando/dtt-club` — **приватный**, здесь исходный код, SQL и документы.
> - `CesarComando/dtt-club-app` — **публичный**, только готовая сборка (ветка `gh-pages`). Он и показывает сайт по адресу `app.daugavpilstopteam.lv`.
>
> `npm run deploy` сам выкладывает сборку в `dtt-club-app` (см. `package.json`). Настройки Pages и домена теперь в **dtt-club-app → Settings → Pages**.
> Шаги 3 и 5 ниже описывают первоначальную настройку и устарели.

Команды для **PowerShell** (Windows). Выполняйте по одной, в папке проекта.
GitHub CLI (`gh`) уже установлен и вошёл в аккаунт **CesarComando**.

## 0. Открыть папку проекта
```powershell
cd C:\Users\danil\Desktop\Failiemlv
```

## 1. Git: представиться (один раз на компьютере)
Имя и email будут видны в истории публичного репозитория.
Вместо личной почты можно взять адрес GitHub вида `…@users.noreply.github.com`
(github.com → Settings → Emails).
```powershell
git config --global user.name "Dainis Miglāns"
git config --global user.email "ВАШ_EMAIL"
```

## 2. Инициализировать Git и сделать commit
```powershell
git init -b main
git add .
git status
```
⚠️ В списке `git status` **не должно быть** `.env` и `node_modules` — они в `.gitignore`.
Если `.env` там есть — остановитесь и не делайте commit.

```powershell
git commit -m "DTT Club: первая версия приложения (слои 1–5)"
```

## 3. Создать репозиторий на GitHub и загрузить код
Репозиторий должен быть **публичным** — на бесплатном тарифе GitHub Pages работает только с публичными.
Секретов в коде нет: ключи Supabase лежат в `.env` и в репозиторий не попадают.
```powershell
gh repo create dtt-club --public --source . --push
```

## 4. Опубликовать сайт
Собирает приложение (с ключами из вашего `.env`) и выкладывает папку `dist` в ветку `gh-pages`.
Файл `CNAME` с доменом `app.daugavpilstopteam.lv` попадает туда автоматически (из папки `public`).
```powershell
npm run deploy
```

## 5. Включить GitHub Pages (один раз)
github.com/CesarComando/dtt-club → **Settings → Pages**:
- **Source:** Deploy from a branch
- **Branch:** `gh-pages` / `(root)` → **Save**
- **Custom domain:** должно стоять `app.daugavpilstopteam.lv` (если пусто — впишите и Save)

Пока DNS не настроен, сайт уже открывается по адресу `https://cesarcomando.github.io/dtt-club/`.

## 6. DNS: поддомен app.daugavpilstopteam.lv (у регистратора домена)
Корневой домен `daugavpilstopteam.lv` занят сайтом-визиткой (репозиторий `CesarComando/daugavpilstopteam`)
и **не трогается**. Приложение живёт на поддомене — нужна одна новая запись:

| Тип | Имя | Значение |
|---|---|---|
| CNAME | app | cesarcomando.github.io |

DNS обновляется от нескольких минут до 24 часов.
Когда в Settings → Pages появится «DNS check successful» — поставьте галочку **Enforce HTTPS**.

**Рекомендуется:** github.com → ваш аватар → Settings → Pages → **Add a domain** → `daugavpilstopteam.lv`.
Это подтверждает, что домен ваш, и не даёт чужим репозиториям его занять.

## Как обновлять сайт потом
После каждого изменения кода:
```powershell
git add .
git commit -m "Что изменилось"
git push
npm run deploy
```

## Важно про Supabase
- Вход у нас по телефону и паролю, поэтому домен в Supabase прописывать не нужно.
- Если позже включим вход через письма или OAuth — добавить `https://app.daugavpilstopteam.lv`
  в Supabase → Authentication → URL Configuration.

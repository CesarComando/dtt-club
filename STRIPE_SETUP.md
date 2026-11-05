# Настройка оплаты Stripe (Слой 7) — тестовый режим

Секретные ключи Stripe живут **только** в секретах Supabase Edge Functions.
Никогда не вставляйте их в `.env`, в код или в чат.

## 1. Stripe: тестовая среда (sandbox)
1. https://dashboard.stripe.com → слева вверху переключатель аккаунта → **Sandboxes** → создайте sandbox `dtt-club-dev`.
2. **Settings → Billing → Customer portal** → включите: обновление карты, просмотр счетов, отмену подписки (в конце периода) → **Save**.
   Без сохранённой настройки кнопка «Управление оплатой» вернёт ошибку.

## 2. Ограниченный ключ (restricted key, `rk_test_…`)
**Developers → API keys → Create restricted key**, имя `supabase-edge`. Права:

| Ресурс | Доступ |
|---|---|
| Customers | Write |
| Products, Prices | Write |
| Checkout Sessions | Write |
| Customer portal | Write |
| Subscriptions, Invoices, Charges | Read |
| Tax calculations / settings | Read (если будет Stripe Tax) |

Скопируйте ключ и в терминале проекта выполните (ключ вставляете вы сами):
```
npx.cmd supabase secrets set STRIPE_SECRET_KEY=rk_test_ВАШ_КЛЮЧ --remote=latnwksisoziluhdadgy
```

## 3. Вебхук
**Developers → Webhooks → Add destination**:
- URL: `https://latnwksisoziluhdadgy.supabase.co/functions/v1/stripe-webhook`
- События: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.paid`, `invoice.payment_failed`, `charge.refunded`.

Откройте созданный эндпоинт → **Signing secret** (`whsec_…`) →
```
npx.cmd supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_ВАШ_СЕКРЕТ --remote=latnwksisoziluhdadgy
```

## 4. База и функции
1. **SQL Editor** → выполнить [`supabase/layer7_payments.sql`](supabase/layer7_payments.sql).
2. Деплой функций (один раз войти: `npx.cmd supabase login`):
```
npx.cmd supabase functions deploy create-checkout customer-portal stripe-webhook --remote=latnwksisoziluhdadgy --use-api
```

## 5. НДС (Stripe Tax) — клуб плательщик PVN
Все цены каталога — **конечные, с НДС внутри** (`tax_behavior: inclusive`): ученик платит ровно 45€ / 40€ / 6€ / 5€.
1. **Tax → Settings**: адрес клуба (Dzirnavu iela 20, Daugavpils) и код налога по умолчанию
   (выберите вместе с бухгалтером из [списка tax codes](https://docs.stripe.com/tax/tax-codes)).
2. **Tax → Locations → Add registration** → Латвия, номер PVN.
3. Включить расчёт НДС в приложении:
```
npx.cmd supabase secrets set STRIPE_TAX_ENABLED=true --remote=latnwksisoziluhdadgy
```
Пока регистрации нет — оставьте `STRIPE_TAX_ENABLED` пустым: иначе Stripe молча посчитает 0 НДС.
Код налога для отдельного товара можно задать в колонке `payment_products.tax_code`.

## 6. Проверка
Кабинет → «Абонемент …» → карта `4242 4242 4242 4242`, любая будущая дата, любой CVC.
После возврата: «Абонемент оплачен до …»; в CRM у ученика — «Оплачен до …».

## Каталог
Таблица `payment_products`. Новый товар (например, мерч GERA) = новая строка, товар и цена в Stripe
создадутся сами при первой покупке. Изменить цену: старой строке `active = false`, добавить новую с другим `id`.

## Перед боевым запуском
Повторить шаги 1–5 в live-режиме (свой ключ `rk_live_…`, свой вебхук и регистрация НДС в live).

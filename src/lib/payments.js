// Оплата через Stripe. Фронтенд НЕ знает секретных ключей: он только просит
// Edge Function создать страницу оплаты и уходит на неё. Статус оплаты
// в базе меняет вебхук на сервере (supabase/functions/stripe-webhook).
import { supabase } from './supabaseClient.js'
import { t, locale } from './i18n.jsx'

// Подписка считается действующей и в статусе past_due: Stripe ещё пытается списать.
export const LIVE_STATUSES = ['active', 'trialing', 'past_due']

export const formatPrice = (cents, currency = 'eur') =>
  new Intl.NumberFormat(locale(), { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 0 })
    .format(cents / 100)

export const formatDay = (iso) =>
  new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })

export async function loadCatalog() {
  const { data, error } = await supabase
    .from('payment_products')
    .select('id, kind, discipline, title, description, amount_cents, currency, billing_interval, sort')
    .eq('active', true)
    .order('sort')
  if (error) throw error
  return data
}

export async function loadMyBilling(userId) {
  const [subs, pays, offline, overview] = await Promise.all([
    supabase.from('subscriptions').select('*, product:payment_products(kind, title, discipline)').eq('user_id', userId),
    supabase
      .from('payments')
      .select('id, product_id, amount_cents, currency, status, method, period_end, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
    // Оплаты до приложения / наличными (список учеников клуба, слой 10) — только свои.
    // Явный отбор по связанному ученику: тренеру RLS отдаёт оплаты всего клуба.
    supabase
      .from('member_payments')
      .select('id, paid_on, amount_cents, kind, method, member:club_members!inner(profile_id)')
      .eq('member.profile_id', userId)
      .order('paid_on', { ascending: false }),
    // Абонемент «месяц от дня оплаты» по всем источникам (слой 17).
    supabase.rpc('membership_overview', { p_only_me: true }),
  ])
  if (subs.error) throw subs.error
  if (pays.error) throw pays.error
  return {
    subscriptions: subs.data,
    payments: pays.data,
    offline: offline.error ? [] : offline.data,
    overview: overview.error ? null : (overview.data?.[0] ?? null),
  }
}

async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    // Текст ошибки функции лежит в теле ответа.
    let message = t('Сервис оплаты недоступен')
    try {
      message = (await error.context?.json())?.error ?? message
    } catch {
      /* тело не JSON */
    }
    throw new Error(message)
  }
  return data
}

// Переход на страницу оплаты Stripe Checkout.
export async function startCheckout(productId) {
  const { url } = await callFunction('create-checkout', { product_id: productId })
  window.location.assign(url)
}

// «Своя сумма» (слой 26): разовая оплата картой на сумму, которую ввёл ученик (1–500 €).
export async function startCustomCheckout(amountCents, note) {
  const { url } = await callFunction('create-checkout', { custom_amount_cents: amountCents, note })
  window.location.assign(url)
}

// Stripe Customer Portal: сменить карту, скачать счета, отменить подписку.
export async function openCustomerPortal() {
  const { url } = await callFunction('customer-portal', {})
  window.location.assign(url)
}

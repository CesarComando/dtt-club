// Вебхук Stripe → статус оплаты в базе. Единственное место, где меняются
// subscriptions / payments (и через триггер — profiles.is_sponsor).
// Деплой без проверки JWT (Stripe не шлёт токен Supabase): подлинность
// проверяется подписью Stripe-Signature и секретом STRIPE_WEBHOOK_SECRET.
import Stripe from 'npm:stripe@23'
import { admin, stripe } from '../_shared/common.ts'

const cryptoProvider = Stripe.createSubtleCryptoProvider()
// trim(): при вставке секрета в Dashboard легко захватить пробел или перенос строки.
const WEBHOOK_SECRET = (Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '').trim()

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === 'string' ? x : x?.id ?? null)

// Stripe Customer → пользователь приложения (через нашу таблицу, не через metadata).
async function userByCustomer(customer: string | null) {
  if (!customer) return null
  const { data } = await admin.from('stripe_customers').select('user_id').eq('customer_id', customer).maybeSingle()
  return (data?.user_id as string) ?? null
}

// Цена Stripe → строка каталога (по price id, запасной путь — lookup_key = код товара).
async function productByPrice(price: Stripe.Price | string | null | undefined) {
  const priceId = idOf(price as never)
  if (!priceId) return null
  const { data } = await admin.from('payment_products').select('id').eq('stripe_price_id', priceId).maybeSingle()
  if (data) return data.id as string
  const p = typeof price === 'string' ? await stripe.prices.retrieve(priceId) : price
  if (!p?.lookup_key) return null
  const { data: byKey } = await admin.from('payment_products').select('id').eq('id', p.lookup_key).maybeSingle()
  return (byKey?.id as string) ?? null
}

// Всегда перечитываем подписку из Stripe: события могут прийти не по порядку.
async function syncSubscription(subscriptionId: string) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  const userId = await userByCustomer(idOf(sub.customer))
  if (!userId) {
    console.warn('subscription without known customer', sub.id)
    return
  }
  const item = sub.items.data[0]
  // С API 2025-03 период хранится на позиции подписки.
  const periodEnd = (item as { current_period_end?: number })?.current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end
  const { error } = await admin.from('subscriptions').upsert({
    id: sub.id,
    user_id: userId,
    product_id: await productByPrice(item?.price),
    status: sub.status,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end || Boolean(sub.cancel_at),
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

// Разовая оплата через Checkout.
async function recordCheckoutPayment(session: Stripe.Checkout.Session) {
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return
  const userId = (await userByCustomer(idOf(session.customer))) ?? session.client_reference_id
  if (!userId) throw new Error(`Unknown user for session ${session.id}`)
  const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 })
  const { error } = await admin.from('payments').upsert(
    {
      user_id: userId,
      product_id: await productByPrice(items.data[0]?.price),
      stripe_session_id: session.id,
      stripe_payment_intent: idOf(session.payment_intent),
      amount_cents: session.amount_total ?? 0,
      currency: session.currency ?? 'eur',
      status: 'paid',
    },
    { onConflict: 'stripe_session_id' },
  )
  if (error) throw error
}

// Списание (или неудачная попытка) по подписке.
async function recordInvoice(invoiceId: string, status: 'paid' | 'failed') {
  const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['payments'] })
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription)
  if (!subscriptionId) return // счёт разовой оплаты — её записал checkout.session.completed
  await syncSubscription(subscriptionId)

  const userId = await userByCustomer(idOf(invoice.customer))
  if (!userId) return
  const line = invoice.lines.data[0]
  const price = line?.pricing?.price_details?.price
  const paymentIntent = invoice.payments?.data?.[0]?.payment?.payment_intent
  const { error } = await admin.from('payments').upsert(
    {
      user_id: userId,
      product_id: await productByPrice(price),
      subscription_id: subscriptionId,
      stripe_invoice_id: invoice.id,
      stripe_payment_intent: idOf(paymentIntent as never),
      amount_cents: status === 'paid' ? invoice.amount_paid : invoice.amount_due,
      currency: invoice.currency,
      status,
    },
    { onConflict: 'stripe_invoice_id' },
  )
  if (error) throw error
}

async function handle(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object
      if (session.mode === 'subscription' && session.subscription) {
        await syncSubscription(idOf(session.subscription)!)
      } else {
        await recordCheckoutPayment(session)
      }
      break
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscription(event.data.object.id)
      break
    case 'invoice.paid':
      await recordInvoice(event.data.object.id!, 'paid')
      break
    case 'invoice.payment_failed':
      await recordInvoice(event.data.object.id!, 'failed')
      break
    case 'charge.refunded': {
      const charge = event.data.object
      const pi = idOf(charge.payment_intent)
      if (pi && charge.refunded) {
        await admin.from('payments').update({ status: 'refunded' }).eq('stripe_payment_intent', pi)
      }
      break
    }
    default:
      // Остальные события не подписаны / не нужны.
      break
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const signature = req.headers.get('stripe-signature')
  const body = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, WEBHOOK_SECRET, undefined, cryptoProvider)
  } catch (e) {
    // Подробности — только в логах функции (Supabase Dashboard), наружу — без деталей о секрете.
    const format = WEBHOOK_SECRET.startsWith('whsec_') ? 'whsec_ ok' : 'missing or not whsec_'
    console.error('Bad signature', (e as Error).message, `secret: ${format}`)
    return new Response('Bad signature', { status: 400 })
  }

  // Повторная доставка уже обработанного события — просто подтверждаем.
  const { data: seen } = await admin.from('stripe_events').select('id').eq('id', event.id).maybeSingle()
  if (seen) return new Response('ok')

  try {
    await handle(event)
    await admin.from('stripe_events').insert({ id: event.id, type: event.type })
    return new Response('ok')
  } catch (e) {
    console.error('Webhook handler failed', event.type, event.id, e)
    // 500 → Stripe повторит доставку позже (обработчики идемпотентны).
    return new Response('Handler error', { status: 500 })
  }
})

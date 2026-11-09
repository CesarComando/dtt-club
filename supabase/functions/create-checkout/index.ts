// POST { product_id } → { url } страницы оплаты Stripe Checkout.
// POST { custom_amount_cents, note? } → то же, но на свою сумму 1–500 € (слой 26).
// POST { shop_order_id } → оплата заказа магазина (слой 38): строки и цены — из заказа в базе.
// Цену берём из каталога payment_products; если товара/цены в Stripe ещё нет — создаём.
import { admin, appUrl, cors, getOrCreateCustomer, getUser, json, stripe } from '../_shared/common.ts'

const TAX_ENABLED = Deno.env.get('STRIPE_TAX_ENABLED') === 'true'

type Product = {
  id: string
  kind: string
  title: string
  description: string | null
  amount_cents: number
  currency: string
  billing_interval: 'month' | 'year' | null
  tax_code: string | null
  stripe_product_id: string | null
  stripe_price_id: string | null
}

// Товар и цена в Stripe для строки каталога. lookup_key = код товара,
// поэтому повторный вызов не плодит дубликаты.
async function ensurePrice(p: Product): Promise<string> {
  if (p.stripe_price_id) return p.stripe_price_id

  const found = (await stripe.prices.list({ lookup_keys: [p.id], active: true, limit: 1 })).data[0]
  const matches =
    found &&
    found.unit_amount === p.amount_cents &&
    found.currency === p.currency &&
    (found.recurring?.interval ?? null) === p.billing_interval
  let price = matches ? found : null

  if (!price) {
    // Нет цены или она устарела — создаём новую (lookup_key переедет на неё).
    let productId = p.stripe_product_id ?? (found ? (found.product as string) : null)
    if (!productId) {
      const product = await stripe.products.create(
        {
          name: p.title,
          description: p.description ?? undefined,
          ...(p.tax_code ? { tax_code: p.tax_code } : {}),
          metadata: { catalog_id: p.id },
        },
        { idempotencyKey: `product-${p.id}` },
      )
      productId = product.id
    }
    price = await stripe.prices.create({
      product: productId,
      currency: p.currency,
      unit_amount: p.amount_cents,
      tax_behavior: 'inclusive', // цена в каталоге — конечная, НДС внутри
      ...(p.billing_interval ? { recurring: { interval: p.billing_interval } } : {}),
      lookup_key: p.id,
      transfer_lookup_key: true,
    })
  }

  await admin
    .from('payment_products')
    .update({ stripe_product_id: price.product as string, stripe_price_id: price.id })
    .eq('id', p.id)
  return price.id
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  // Диагностика: в каком режиме ключ Stripe (сам ключ не раскрывается).
  if (req.method === 'GET') {
    const key = Deno.env.get('STRIPE_SECRET_KEY')?.trim() ?? ''
    const mode = /^(rk|sk)_live_/.test(key) ? 'live' : /^(rk|sk)_test_/.test(key) ? 'test' : 'invalid'
    return json(req, { stripe_mode: mode, tax: TAX_ENABLED })
  }
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const user = await getUser(req)
    if (!user) return json(req, { error: 'Войдите в аккаунт' }, 401)

    const body = await req.json().catch(() => ({}))
    const base = appUrl(req)

    // Магазин (слой 38): заказ уже посчитан в базе функцией shop_place_order — берём оттуда.
    // Оплату отметит триггер shop_on_payment по примечанию «Магазин: заказ №N».
    if (body.shop_order_id != null) {
      const { data: order } = await admin
        .from('shop_orders').select('id, user_id, items, total_cents, status')
        .eq('id', Number(body.shop_order_id)).maybeSingle()
      if (!order || order.user_id !== user.id) return json(req, { error: 'Заказ не найден' }, 404)
      if (order.status !== 'awaiting_payment') return json(req, { error: 'Этот заказ уже оплачен или отменён' }, 409)
      type Item = { title: string; design_title?: string | null; variant: string; size?: string | null; qty: number; price_cents: number }
      const line_items = (order.items as Item[]).map((it) => ({
        price_data: {
          currency: 'eur',
          unit_amount: it.price_cents,
          product_data: {
            name: [it.title, it.design_title, it.variant === 'kid' ? 'детский' : null, it.size].filter(Boolean).join(' · ').slice(0, 250),
          },
        },
        quantity: it.qty,
      }))
      const note = `Магазин: заказ №${order.id}`
      const customer = await getOrCreateCustomer(user.id)
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer,
        client_reference_id: user.id,
        line_items,
        metadata: { kind: 'shop', shop_order: String(order.id), note },
        payment_intent_data: { description: note, metadata: { kind: 'shop', shop_order: String(order.id), note } },
        locale: 'auto',
        success_url: `${base}/#/shop?paid=${order.id}`,
        cancel_url: `${base}/#/shop`,
        invoice_creation: { enabled: true },
        integration_identifier: 'dtt-club-checkout-qhvmzpta',
      })
      return json(req, { url: session.url })
    }

    // «Своя сумма» (слой 26): разовая оплата на сумму, которую ввёл ученик, 1–500 €.
    // Без товара из каталога — на абонемент не влияет; «за что» уходит в metadata.note.
    if (body.custom_amount_cents != null) {
      const cents = Number(body.custom_amount_cents)
      if (!Number.isInteger(cents) || cents < 100 || cents > 50000) {
        return json(req, { error: 'Сумма должна быть от 1 до 500 €' }, 400)
      }
      const note = String(body.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
      const name = note ? `Оплата клубу DTT — ${note}` : 'Оплата клубу DTT'
      const customer = await getOrCreateCustomer(user.id)
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer,
        client_reference_id: user.id,
        line_items: [{ price_data: { currency: 'eur', unit_amount: cents, product_data: { name } }, quantity: 1 }],
        metadata: { kind: 'custom', note },
        payment_intent_data: { description: name, metadata: { kind: 'custom', note } },
        locale: 'auto',
        success_url: `${base}/#/dashboard?payment=success`,
        cancel_url: `${base}/#/dashboard?payment=cancel`,
        invoice_creation: { enabled: true },
        integration_identifier: 'dtt-club-checkout-qhvmzpta',
      })
      return json(req, { url: session.url })
    }

    const { product_id } = body
    const { data: product } = await admin
      .from('payment_products').select('*').eq('id', product_id).eq('active', true).maybeSingle()
    if (!product) return json(req, { error: 'Товар не найден' }, 404)

    const isSubscription = Boolean(product.billing_interval)

    // Не даём оформить вторую такую же подписку — для изменений есть портал.
    if (isSubscription) {
      const { data: live } = await admin
        .from('subscriptions').select('id')
        .eq('user_id', user.id).eq('product_id', product.id)
        .in('status', ['active', 'trialing', 'past_due'])
        .limit(1)
      if (live?.length) return json(req, { error: 'Эта подписка уже оформлена' }, 409)
    }

    const [priceId, customer] = await Promise.all([ensurePrice(product), getOrCreateCustomer(user.id)])

    const session = await stripe.checkout.sessions.create({
      mode: isSubscription ? 'subscription' : 'payment',
      customer,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      locale: 'auto',
      success_url: `${base}/#/dashboard?payment=success`,
      cancel_url: `${base}/#/dashboard?payment=cancel`,
      ...(TAX_ENABLED
        ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto', name: 'auto' } }
        : {}),
      // Разовая оплата: Stripe выставит счёт (invoice) — квитанция для бухгалтерии.
      ...(isSubscription ? {} : { invoice_creation: { enabled: true } }),
      integration_identifier: 'dtt-club-checkout-qhvmzpta',
    })

    return json(req, { url: session.url })
  } catch (e) {
    console.error('create-checkout', e)
    // Текст ошибки Stripe не содержит секретов и сильно упрощает диагностику.
    return json(req, { error: `Не удалось начать оплату: ${(e as Error).message}` }, 500)
  }
})

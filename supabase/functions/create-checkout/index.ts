// POST { product_id } → { url } страницы оплаты Stripe Checkout.
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
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const user = await getUser(req)
    if (!user) return json(req, { error: 'Войдите в аккаунт' }, 401)

    const { product_id } = await req.json().catch(() => ({}))
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
    const base = appUrl(req)

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
    return json(req, { error: 'Не удалось начать оплату. Попробуйте позже.' }, 500)
  }
})

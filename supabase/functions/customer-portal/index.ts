// POST → { url } Stripe Customer Portal: карта, счета, отмена подписки.
import { admin, appUrl, cors, getUser, json, stripe } from '../_shared/common.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const user = await getUser(req)
    if (!user) return json(req, { error: 'Войдите в аккаунт' }, 401)

    const { data } = await admin
      .from('stripe_customers').select('customer_id').eq('user_id', user.id).maybeSingle()
    if (!data) return json(req, { error: 'Оплат ещё не было' }, 404)

    const session = await stripe.billingPortal.sessions.create({
      customer: data.customer_id,
      return_url: `${appUrl(req)}/#/dashboard`,
      locale: 'auto',
    })
    return json(req, { url: session.url })
  } catch (e) {
    console.error('customer-portal', e)
    return json(req, { error: `Не удалось открыть управление оплатой: ${(e as Error).message}` }, 500)
  }
})

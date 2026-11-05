// Общие помощники Edge Functions оплаты (Deno).
// Секреты берутся ТОЛЬКО из секретов Supabase (Dashboard → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY       — тестовый ключ rk_test_… / sk_test_… (в git и фронтенд не попадает)
//   STRIPE_WEBHOOK_SECRET   — whsec_… эндпоинта вебхука
//   STRIPE_TAX_ENABLED      — 'true', когда в Stripe Tax добавлена регистрация НДС Латвии
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
import Stripe from 'npm:stripe@23'
import { createClient } from 'npm:@supabase/supabase-js@2'

// Если секрет ещё не задан — функция всё равно стартует, а вызовы Stripe вернут понятную ошибку.
export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')?.trim() || 'rk_test_missing_STRIPE_SECRET_KEY', {
  httpClient: Stripe.createFetchHttpClient(),
  appInfo: { name: 'dtt-club', url: 'https://app.daugavpilstopteam.lv' },
})

// Клиент с ключом service_role: обходит RLS, поэтому живёт только на сервере.
export const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

// Куда Stripe возвращает после оплаты. Только из белого списка — чужой origin не пройдёт.
const ALLOWED_ORIGINS = [
  'https://app.daugavpilstopteam.lv',
  'http://localhost:5173',
  'http://localhost:4173',
]
export const appUrl = (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
}

export const cors = (req: Request) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(req.headers.get('origin') ?? '')
    ? req.headers.get('origin')!
    : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
})

export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json' },
  })

// Пользователь по JWT из заголовка Authorization (проверяем сами, а не шлюзом).
export async function getUser(req: Request) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  return error ? null : data.user
}

// Stripe Customer пользователя: берём из базы или создаём (один на человека).
export async function getOrCreateCustomer(userId: string) {
  const { data: existing } = await admin
    .from('stripe_customers').select('customer_id').eq('user_id', userId).maybeSingle()
  if (existing) return existing.customer_id as string

  const [{ data: profile }, { data: contact }] = await Promise.all([
    admin.from('profiles').select('first_name, last_name').eq('id', userId).single(),
    admin.from('profile_contacts').select('phone').eq('id', userId).maybeSingle(),
  ])
  const customer = await stripe.customers.create(
    {
      name: profile ? `${profile.first_name} ${profile.last_name}`.trim() : undefined,
      phone: contact?.phone ? `+${contact.phone}` : undefined,
      preferred_locales: ['ru', 'lv'],
      metadata: { supabase_user_id: userId },
    },
    { idempotencyKey: `customer-${userId}` },
  )
  const { error } = await admin.from('stripe_customers').insert({ user_id: userId, customer_id: customer.id })
  if (error) {
    // Параллельный запрос успел первым — используем его запись.
    const { data } = await admin.from('stripe_customers').select('customer_id').eq('user_id', userId).single()
    return data!.customer_id as string
  }
  return customer.id
}

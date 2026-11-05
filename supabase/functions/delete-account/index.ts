// POST { confirm: 'УДАЛИТЬ' } → удаляет аккаунт текущего пользователя
// (требование Google Play / App Store: удаление аккаунта из приложения).
// POST { confirm: 'УДАЛИТЬ', athlete_id } → тренер удаляет аккаунт ученика.
//
// Порядок: отменить подписки в Stripe (чтобы не было списаний) → удалить
// селфи из Storage → удалить пользователя Auth. Профиль, телефон, посещения,
// записи и локальные копии платежей удаляются каскадом (on delete cascade).
// Сами платежи остаются в Stripe — это бухгалтерские документы клуба.
import { admin, cors, getUser, json, stripe } from '../_shared/common.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const user = await getUser(req)
    if (!user) return json(req, { error: 'Войдите в аккаунт' }, 401)

    const { confirm, athlete_id } = await req.json().catch(() => ({}))
    if (confirm !== 'УДАЛИТЬ') return json(req, { error: 'Нет подтверждения удаления' }, 400)

    const { data: caller } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    const isCoach = caller?.role === 'admin'

    // Кого удаляем: себя или (только тренер) указанного ученика.
    let targetId = user.id
    if (athlete_id && athlete_id !== user.id) {
      if (!isCoach) return json(req, { error: 'Удалять чужие аккаунты может только тренер' }, 403)
      targetId = athlete_id
    }
    const { data: target } = await admin.from('profiles').select('role').eq('id', targetId).maybeSingle()
    if (!target) return json(req, { error: 'Аккаунт не найден' }, 404)
    if (target.role === 'admin') {
      return json(req, { error: 'Аккаунт тренера удаляется только вручную в Supabase' }, 403)
    }

    // 1. Подписки Stripe — отменяем сразу, иначе карта продолжит списываться.
    const { data: cust } = await admin
      .from('stripe_customers').select('customer_id').eq('user_id', targetId).maybeSingle()
    if (cust) {
      const subs = await stripe.subscriptions.list({ customer: cust.customer_id, status: 'all', limit: 100 })
      for (const s of subs.data) {
        if (!['canceled', 'incomplete_expired'].includes(s.status)) {
          await stripe.subscriptions.cancel(s.id)
        }
      }
    }

    // 2. Селфи и файлы галереи пользователя в приватных бакетах (папка <user_id>/).
    for (const bucket of ['avatars', 'gallery']) {
      const { data: files } = await admin.storage.from(bucket).list(targetId, { limit: 1000 })
      if (files?.length) {
        await admin.storage.from(bucket).remove(files.map((f) => `${targetId}/${f.name}`))
      }
    }

    // 3. Пользователь Auth → каскадом profiles, profile_contacts, attendance, bookings, payments…
    const { error } = await admin.auth.admin.deleteUser(targetId)
    if (error) throw error

    return json(req, { ok: true })
  } catch (e) {
    console.error('delete-account', e)
    return json(req, { error: `Не удалось удалить аккаунт: ${(e as Error).message}` }, 500)
  }
})

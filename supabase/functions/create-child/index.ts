// POST { first_name, last_name, discipline, password } → родитель создаёт аккаунт ребёнка.
// Возвращает { login, email } — логин ребёнка «<телефон родителя>-N».
//
// Зачем на сервере (слой 33): раньше ребёнок регистрировался прямо из браузера,
// и любой, кто знал телефон родителя, мог «подсунуть» ему фальшивого ребёнка.
// Теперь: проверяем, что вызывает сам родитель (по JWT) → кладём одноразовое
// разрешение в child_grants → создаём пользователя. Триггер handle_new_user
// без разрешения детский логин не пропустит.
import { admin, cors, getUser, json } from '../_shared/common.ts'

const DOMAIN = 'dtt.local'
const DISCIPLINES = ['grappling', 'mma', 'both']
const MAX_CHILDREN = 20

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const user = await getUser(req)
    if (!user) return json(req, { error: 'Войдите в аккаунт' }, 401)

    // Родитель — обычный аккаунт с логином-телефоном, сам не ребёнок.
    const [base, domain] = (user.email ?? '').split('@')
    if (domain !== DOMAIN || !/^\d{8,15}$/.test(base)) {
      return json(req, { error: 'В вашем профиле нет номера телефона — добавить ребёнка нельзя.' }, 400)
    }
    const { data: parent } = await admin.from('profiles').select('parent_id').eq('id', user.id).maybeSingle()
    if (!parent) return json(req, { error: 'Профиль не найден' }, 404)
    if (parent.parent_id) return json(req, { error: 'Детский аккаунт не может добавлять детей' }, 403)

    const body = await req.json().catch(() => ({}))
    const firstName = String(body.first_name ?? '').trim().slice(0, 60)
    const lastName = String(body.last_name ?? '').trim().slice(0, 60)
    const discipline = DISCIPLINES.includes(body.discipline) ? body.discipline : 'mma'
    const password = String(body.password ?? '')
    if (!firstName) return json(req, { error: 'Укажите имя ребёнка' }, 400)
    if (password.length < 6) return json(req, { error: 'Пароль — минимум 6 символов' }, 400)

    // Занятые номера: 1, 2, 3… берём первый свободный.
    const { data: taken } = await admin.from('profile_contacts').select('phone').like('phone', `${base}-%`)
    const used = new Set((taken ?? []).map((r) => Number(String(r.phone).split('-')[1])))
    if (used.size >= MAX_CHILDREN) return json(req, { error: 'Слишком много детских аккаунтов' }, 400)

    for (let n = 1; n <= MAX_CHILDREN; n++) {
      if (used.has(n)) continue
      const login = `${base}-${n}`
      const email = `${login}@${DOMAIN}`
      const grant = await admin.from('child_grants').upsert({
        login,
        parent_id: user.id,
        expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
      if (grant.error) throw grant.error

      const { error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { first_name: firstName, last_name: lastName, discipline },
      })
      if (!error) return json(req, { login, email })

      await admin.from('child_grants').delete().eq('login', login)
      if (/already (been )?registered|already exists/i.test(error.message)) continue
      throw error
    }
    return json(req, { error: 'Не удалось подобрать логин для ребёнка.' }, 409)
  } catch (e) {
    console.error('create-child', e)
    return json(req, { error: 'Не удалось создать аккаунт ребёнка. Попробуйте ещё раз.' }, 500)
  }
})

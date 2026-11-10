// «Забыли пароль?» по SMS (слой 44). Вход в приложение — по номеру телефона,
// поэтому код приходит SMS на этот номер.
//
// POST { action: 'request', phone }                    → отправить 6-значный код (10 минут)
// POST { action: 'confirm', phone, code, password }    → проверить код и поставить новый пароль
//
// SMS отправляет Twilio. Секреты Supabase (Edge Functions → Secrets):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN и TWILIO_FROM (номер или имя отправителя, напр. «DTT»)
//   либо TWILIO_MESSAGING_SERVICE_SID вместо TWILIO_FROM.
// Пока их нет — отвечаем { error: 'sms_off' }, и приложение предлагает написать тренеру.
//
// Защита: ответ на 'request' одинаковый, есть номер в клубе или нет; не больше 3 кодов
// на номер и 10 на IP в час; на код — 5 попыток; хранится только хеш кода.
import { admin, cors, json } from '../_shared/common.ts'

const SID = Deno.env.get('TWILIO_ACCOUNT_SID')?.trim()
const TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')?.trim()
const FROM = Deno.env.get('TWILIO_FROM')?.trim()
const MSID = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')?.trim()
const SMS_ON = Boolean(SID && TOKEN && (FROM || MSID))
const PEPPER = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Как в приложении (src/lib/auth.js): 8 цифр с 2/6 — латвийский номер без +371.
function normalizePhone(raw: unknown) {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 8 && /^[26]/.test(d)) d = '371' + d
  return d
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const sixDigits = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')

async function sendSms(to: string, body: string) {
  const form = new URLSearchParams({ To: `+${to}`, Body: body })
  if (MSID) form.set('MessagingServiceSid', MSID)
  else form.set('From', FROM!)
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${SID}:${TOKEN}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

const hourAgo = () => new Date(Date.now() - 3600_000).toISOString()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const phone = normalizePhone(body.phone)
    if (phone.length < 10 || phone.length > 15) return json(req, { error: 'Проверьте номер телефона' }, 400)
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null

    if (body.action === 'request') {
      if (!SMS_ON) return json(req, { error: 'sms_off' }, 503)

      const [{ count: perPhone }, { count: perIp }] = await Promise.all([
        admin.from('password_reset_codes').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', hourAgo()),
        ip
          ? admin.from('password_reset_codes').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', hourAgo())
          : Promise.resolve({ count: 0 }),
      ])
      if ((perPhone ?? 0) >= 3 || (perIp ?? 0) >= 10) {
        return json(req, { error: 'Слишком много запросов. Попробуйте через час или напишите тренеру.' }, 429)
      }

      const { data: contact } = await admin.from('profile_contacts').select('id').eq('phone', phone).maybeSingle()
      if (contact) {
        const code = sixDigits()
        await admin.from('password_reset_codes').insert({
          user_id: contact.id,
          phone,
          code_hash: await sha256(`${phone}:${code}:${PEPPER}`),
          ip,
          expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        })
        await sendSms(phone, `DTT: kods paroles maiņai / код для смены пароля: ${code}. Nevienam neizpaudiet / никому не сообщайте.`)
      }
      // Одинаковый ответ — по нему нельзя узнать, есть ли номер в клубе.
      return json(req, { ok: true })
    }

    if (body.action === 'confirm') {
      const code = String(body.code ?? '').replace(/\D/g, '')
      const password = String(body.password ?? '')
      if (code.length !== 6) return json(req, { error: 'Код — 6 цифр из SMS' }, 400)
      if (password.length < 6) return json(req, { error: 'Пароль — минимум 6 символов' }, 400)

      const { data: row } = await admin
        .from('password_reset_codes')
        .select('id, user_id, code_hash, attempts, expires_at')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!row || new Date(row.expires_at) < new Date() || row.attempts >= 5) {
        return json(req, { error: 'Код устарел. Запросите новый.' }, 400)
      }
      if ((await sha256(`${phone}:${code}:${PEPPER}`)) !== row.code_hash) {
        await admin.from('password_reset_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id)
        return json(req, { error: 'Неверный код' }, 400)
      }

      const { error } = await admin.auth.admin.updateUserById(row.user_id, { password })
      if (error) throw error
      await admin.from('password_reset_codes').delete().eq('user_id', row.user_id)
      return json(req, { ok: true })
    }

    return json(req, { error: 'Неизвестное действие' }, 400)
  } catch (e) {
    console.error('password-reset', e)
    return json(req, { error: 'Не получилось. Попробуйте позже или напишите тренеру.' }, 500)
  }
})

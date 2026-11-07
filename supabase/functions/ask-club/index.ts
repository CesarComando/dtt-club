// POST { messages: [{ role: 'user'|'assistant', content }] } → { answer }
// ИИ-помощник клуба «Спросить»: отвечает по фактам клуба и по данным САМОГО ученика
// (его абонемент и записи). Чужие данные в запрос к Claude не попадают.
//
// Секреты (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY  — ключ из console.anthropic.com (в git и фронтенд не попадает)
//   ANTHROPIC_MODEL    — необязательно; по умолчанию claude-haiku-5-5 (быстро и дёшево)
//   ASK_DAILY_LIMIT    — необязательно; вопросов в день на человека, по умолчанию 30
import { createClient } from 'npm:@supabase/supabase-js@2'
import { admin, cors, getUser, json } from '../_shared/common.ts'

const MODEL = Deno.env.get('ANTHROPIC_MODEL')?.trim() || 'claude-haiku-5-5'
const LIMIT = Number(Deno.env.get('ASK_DAILY_LIMIT') ?? 30) || 30
const DAYS = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
const euro = (c: number) => `${(c / 100).toFixed(c % 100 ? 2 : 0)} €`
const riga = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Riga', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

async function clubContext() {
  const [facts, slots, products, sessions] = await Promise.all([
    admin.from('club_info').select('body').eq('key', 'facts').maybeSingle(),
    admin.from('training_slots').select('title, weekday, start_time, end_time, venue:training_venues!training_slots_venue_id_fkey(name, address)')
      .eq('active', true).order('weekday').order('start_time'),
    admin.from('payment_products').select('title, kind, amount_cents, billing_interval')
      .eq('active', true).in('kind', ['membership', 'single']).order('sort'),
    admin.from('training_sessions').select('starts_at, cancelled, slot:training_slots(title), venue:training_venues(name, address)')
      .gte('starts_at', new Date().toISOString())
      .lte('starts_at', new Date(Date.now() + 8 * 864e5).toISOString())
      .order('starts_at'),
  ])
  const sched = (slots.data ?? []).map((s: any) =>
    `- ${DAYS[s.weekday]} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)} · ${s.title}${s.venue ? ` · ${s.venue.name}, ${s.venue.address ?? ''}` : ''}`).join('\n')
  const prices = (products.data ?? []).map((p: any) =>
    `- ${p.title}: ${euro(p.amount_cents)}${p.billing_interval === 'month' ? ' в месяц' : ''}`).join('\n')
  const next = (sessions.data ?? []).map((s: any) =>
    `- ${riga(s.starts_at)} · ${s.slot?.title ?? ''}${s.venue ? ` · ${s.venue.name}` : ''}${s.cancelled ? ' · ОТМЕНЕНА' : ''}`).join('\n')
  return `ФАКТЫ КЛУБА:\n${facts.data?.body ?? ''}\n\nРАСПИСАНИЕ (каждую неделю):\n${sched}\n\nЦЕНЫ В ПРИЛОЖЕНИИ:\n${prices}\n\nБЛИЖАЙШИЕ ЗАНЯТИЯ (8 дней):\n${next || '—'}`
}

async function personalContext(req: Request, userId: string) {
  // Абонемент считаем от имени самого ученика (RLS + p_only_me), а не service_role.
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('authorization') ?? '' } },
    auth: { persistSession: false },
  })
  const [profile, ms, books] = await Promise.all([
    admin.from('profiles').select('first_name, discipline').eq('id', userId).maybeSingle(),
    asUser.rpc('membership_overview', { p_only_me: true }),
    admin.from('bookings').select('session:training_sessions(starts_at, cancelled, slot:training_slots(title))')
      .eq('athlete_id', userId),
  ])
  const m = (ms.data ?? [])[0]
  const today = new Date().toISOString().slice(0, 10)
  const membership = m?.valid_until
    ? `абонемент до ${m.valid_until} (${m.valid_until >= today ? 'действует' : 'закончился'}; оплата: ${{ card: 'картой в приложении', cash: 'наличными', bank: 'переводом' }[m.source as string] ?? m.source})`
    : 'данных об абонементе нет'
  const my = (books.data ?? [])
    .map((b: any) => b.session)
    .filter((s: any) => s && s.starts_at > new Date().toISOString())
    .sort((a: any, b: any) => (a.starts_at < b.starts_at ? -1 : 1))
    .map((s: any) => `- ${riga(s.starts_at)} · ${s.slot?.title ?? ''}${s.cancelled ? ' · ОТМЕНЕНА' : ''}`).join('\n')
  return `О СОБЕСЕДНИКЕ:\nИмя: ${profile.data?.first_name ?? ''}\nНаправление: ${profile.data?.discipline ?? 'не указано'}\nАбонемент: ${membership}\nЗаписан на:\n${my || '—'}\nСегодня: ${riga(new Date().toISOString())}`
}

const SYSTEM = `Ты помощник в приложении клубов Daugavpils Top Team (MMA, K1) и Daugavpils Grappling Team (грэпплинг). Отвечаешь ученикам и родителям.
Правила:
- Отвечай только по данным ниже. Если ответа там нет — честно скажи и предложи написать тренеру в WhatsApp: +371 27 167 013. Ничего не придумывай: ни цен, ни времени, ни правил.
- Отвечай на языке вопроса (русский, латышский или английский), коротко и дружелюбно: 1–4 предложения, без лишних списков.
- Про абонемент и записи говори только о самом собеседнике. О других людях данных у тебя нет.
- Записаться, отменить запись или оплатить нельзя через тебя — подскажи, где это в приложении: «Кабинет» → «Запись на тренировки», оплата — в «Кабинете».
- Травмы и здоровье: не ставь диагнозы, советуй врача и предупредить тренера.
- Не обсуждай темы, не связанные с клубом и тренировками; вежливо возвращай к клубу.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  try {
    const user = await getUser(req)
    if (!user) return json(req, { error: 'Войдите в аккаунт' }, 401)
    const key = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
    if (!key) return json(req, { error: 'Помощник ещё не настроен' }, 503)

    const body = await req.json().catch(() => ({}))
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-10)
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 1500) }))
    if (!messages.length || messages[messages.length - 1].role !== 'user')
      return json(req, { error: 'Пустой вопрос' }, 400)
    while (messages[0]?.role === 'assistant') messages.shift()

    const { data: used, error: bumpErr } = await admin.rpc('assistant_bump', { p_user: user.id })
    if (bumpErr) throw bumpErr
    if ((used as number) > LIMIT)
      return json(req, { error: `Лимит ${LIMIT} вопросов на сегодня. Завтра можно снова, а срочное — тренеру в WhatsApp.` }, 429)

    const [club, me] = await Promise.all([clubContext(), personalContext(req, user.id)])
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: `${SYSTEM}\n\n${club}\n\n${me}`,
        messages,
      }),
    })
    const out = await r.json()
    if (!r.ok) {
      console.error('ask-club anthropic', r.status, out?.error)
      return json(req, { error: 'Помощник сейчас недоступен, попробуйте позже' }, 502)
    }
    const answer = (out.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim()
    return json(req, { answer: answer || 'Не получилось ответить. Напишите тренеру: +371 27 167 013.' })
  } catch (e) {
    console.error('ask-club', e)
    return json(req, { error: 'Ошибка помощника, попробуйте позже' }, 500)
  }
})

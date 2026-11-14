import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApprovedMark, ApproveButton } from './Approved.jsx'
import { MembershipLine, loadMemberships } from './AdminMemberships.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { formatPrice } from '../lib/payments.js'
import { RANKS, DISCIPLINES } from '../lib/ranks.js'
import { t, locale } from '../lib/i18n.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { cached, friendlyError, isNetworkError } from '../lib/offline.js'
import { enqueue } from '../lib/outbox.js'

// CRM: все ученики клуба, в том числе без аккаунта в приложении,
// с историей оплат вне приложения (банк, наличные). Связка с аккаунтом —
// функция link_member (ранг и направление переносятся в профиль).

const STATUS = { regular: t('Постоянный'), occasional: t('Иногда'), one_time: t('Был раз'), left: t('Ушёл') }
const KIND = {
  training: t('тренировка'), membership: t('абонемент'), pack: t('пакет'), individual: t('индивид.'),
  uniform: t('форма'), donation: t('пожертвование'), other: t('другое'),
}
// Нормализация имён для поиска совпадений: латиница без диакритики,
// кириллица → латиница (Андрей ≈ Andrejs, Ņikita ≈ Никита).
const CYR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'z',з:'z',и:'i',й:'j',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'c',ш:'s',щ:'s',ъ:'',ы:'i',ь:'',э:'e',ю:'ju',я:'ja' }
const norm = (t) =>
  (t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[а-яё]/g, (c) => CYR[c] ?? c).replace(/[^a-z ]/g, ' ')
// Andrejs/Андрей → andre; Mariss/Maris → mar (двойная «s» на конце схлопывается до окончания).
const stem = (w) => w.replace(/s+$/, 's').replace(/(ijs|js|is|s)$/, '').slice(0, 5)
const tokens = (t) => norm(t).split(/\s+/).filter((w) => w.length > 1).map(stem)
// Одна опечатка в длинном слове — всё ещё совпадение (Gaigulis ≈ Gsigulis).
const close = (a, b) => {
  if (a === b) return true
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  const ra = a.slice(i + 1), rb = b.slice(i + 1)
  return ra === rb || a.slice(i) === rb || ra === b.slice(i)
}
const matchScore = (profile, m) => {
  const pt = tokens(`${profile.first_name} ${profile.last_name}`)
  const names = [`${m.first_name} ${m.last_name}`, ...(m.aliases ?? [])]
  let best = 0
  for (const n of names) {
    const mt = tokens(n)
    if (!mt.length) continue
    const hit = mt.filter((w) => pt.some((x) => close(w, x))).length
    best = Math.max(best, hit / Math.max(mt.length, pt.length))
  }
  return best
}

/** Аккаунты в приложении, не связанные с учеником клуба, + кандидаты по имени. */
// Родители (и другие взрослые, кто платит за ученика) — это не ученики:
// их телефон лежит в club_contacts с member_id ребёнка. В «Новых» их не показываем.
function LinkSuggestions({ members, profiles, linkedIds, contacts, onChanged }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [parentFor, setParentFor] = useState(null) // profile_id, для которого открыт выбор ребёнка
  const [pickFor, setPickFor] = useState(null) // profile_id, для которого открыт ручной выбор ученика
  const parentOf = Object.fromEntries(contacts.filter((c) => c.phone && c.member_id).map((c) => [c.phone, c.member_id]))
  const unlinked = profiles.filter((p) => !linkedIds.has(p.id) && !(p.phone && parentOf[p.phone]))
  const parents = profiles.filter((p) => !linkedIds.has(p.id) && p.phone && parentOf[p.phone])
  if (!unlinked.length && !parents.length) return null
  const free = members.filter((m) => !m.profile_id)
  const byId = Object.fromEntries(members.map((m) => [m.id, m]))

  const run = async (profileId, fn) => {
    setBusy(profileId)
    setError('')
    try {
      await fn()
      await onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }
  const ok = ({ error: e }) => {
    if (e) throw e
  }

  const link = (memberId, profileId) =>
    run(profileId, async () => ok(await supabase.rpc('link_member', { p_member: memberId, p_profile: profileId })))

  // Человека нет в списке клуба — создаём запись из аккаунта и сразу связываем.
  const createMember = (p) =>
    run(p.id, async () => {
      const { data, error: e } = await supabase
        .from('club_members')
        .insert({ first_name: p.first_name, last_name: p.last_name, discipline: p.discipline ?? null, status: 'regular', phone: p.phone ?? null })
        .select('id')
        .single()
      if (e) throw e
      ok(await supabase.rpc('link_member', { p_member: data.id, p_profile: p.id }))
    })

  // Аккаунт — родитель ученика клуба: телефон → club_contacts, имя → «родитель» у ребёнка.
  const markParent = (p, memberId) =>
    run(p.id, async () => {
      if (!p.phone) throw new Error(t('У аккаунта нет телефона'))
      const name = `${p.first_name} ${p.last_name}`
      ok(await supabase.from('club_contacts').upsert(
        { display_name: `${name} (родитель)`, phone: p.phone, member_id: Number(memberId), source: 'coach' },
        { onConflict: 'phone' },
      ))
      ok(await supabase.from('club_members').update({ parent_name: name }).eq('id', memberId).is('parent_name', null))
      setParentFor(null)
    })

  return (
    <div className="space-y-2 rounded-md border border-accent/40 p-3">
      {error && <p className="text-sm text-accent">{error}</p>}
      {unlinked.length > 0 && <p className="label">{t('Новые в приложении — с кем связать')}</p>}
      {unlinked.map((p) => {
        // Совпал телефон — первая подсказка (📞). Сама база больше не связывает:
        // номер при регистрации не проверяется, поэтому подтверждает тренер (слой 33).
        const cands = free
          .map((m) => ({ m, s: p.phone && m.phone === p.phone ? 2 : matchScore(p, m) }))
          .filter((x) => x.s >= 0.5)
          .sort((a, b) => b.s - a.s)
          .slice(0, 3)
        return (
          <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Link to={`/admin/athlete/${p.id}`} className="font-semibold hover:text-accent hover:underline">
              {p.first_name} {p.last_name}
            </Link>
            <span className="text-neutral-500">→</span>
            {cands.length ? (
              cands.map(({ m, s }) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy === p.id}
                  onClick={() => link(m.id, p.id)}
                  title={s === 2 ? t('Совпадает номер телефона') : undefined}
                  className="rounded border border-line px-2 py-0.5 hover:border-accent disabled:opacity-50"
                >
                  {s === 2 && '📞 '}{m.first_name} {m.last_name}
                </button>
              ))
            ) : (
              <span className="text-neutral-500">{t('совпадений нет')}</span>
            )}
            {pickFor === p.id ? (
              <select
                className="input !w-auto !py-1 text-sm"
                defaultValue=""
                disabled={busy === p.id}
                onChange={(e) => e.target.value && (setPickFor(null), link(Number(e.target.value), p.id))}
              >
                <option value="">{t('Кто это?')}</option>
                {free.filter((m) => m.status !== 'left')
                  .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))
                  .map((m) => (
                    <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
                  ))}
              </select>
            ) : (
              <button
                type="button"
                onClick={() => setPickFor(p.id)}
                className="rounded border border-dashed border-line px-2 py-0.5 text-neutral-300 hover:border-accent"
              >
                {t('Другой…')}
              </button>
            )}
            <button
              type="button"
              disabled={busy === p.id}
              onClick={() => createMember(p)}
              className="rounded border border-dashed border-line px-2 py-0.5 text-neutral-300 hover:border-accent disabled:opacity-50"
            >
              {t('＋ Новый ученик')}
            </button>
            {p.phone && (
              parentFor === p.id ? (
                <select
                  className="input !w-auto !py-1 text-sm"
                  defaultValue=""
                  disabled={busy === p.id}
                  onChange={(e) => e.target.value && markParent(p, e.target.value)}
                >
                  <option value="">{t('Чей родитель?')}</option>
                  {members.filter((m) => m.status !== 'left').map((m) => (
                    <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  onClick={() => setParentFor(p.id)}
                  className="rounded border border-dashed border-line px-2 py-0.5 text-neutral-300 hover:border-accent"
                >
                  {t('Родитель…')}
                </button>
              )
            )}
          </div>
        )
      })}
      {parents.length > 0 && (
        <p className="text-xs text-neutral-500">
          {t('Родители:')}{' '}
          {parents.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ' · '}
              <span className="text-neutral-300">{p.first_name} {p.last_name}</span>
              {' → '}
              {byId[parentOf[p.phone]] ? `${byId[parentOf[p.phone]].first_name} ${byId[parentOf[p.phone]].last_name}` : '—'}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

const day = (d) => new Date(d).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })

function MemberRow({ m, profiles, linkedIds, membership, onChanged, onProfileChange }) {
  const { profile: me } = useAuth()
  const [price, setPrice] = useState(m.single_price_cents ? String(m.single_price_cents / 100) : '')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pays = m.member_payments ?? []
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ amount: '', kind: 'training', method: 'cash', date: today })
  // До какого числа будет абонемент после этой оплаты — тот же расчёт, что в базе
  // (member_membership_until): месяц от дня оплаты или от конца действующего.
  const untilAfter = (() => {
    if (form.kind !== 'membership' || !form.date) return null
    const days = [...new Set(pays.filter((p) => p.kind === 'membership').map((p) => p.paid_on).concat(form.date))].sort()
    let end = null
    for (const d of days) {
      const from = end && end > d ? end : d
      const x = new Date(from + 'T12:00:00Z')
      const dd = x.getUTCDate()
      x.setUTCMonth(x.getUTCMonth() + 1)
      if (x.getUTCDate() !== dd) x.setUTCDate(0) // 31.01 + месяц = 28.02, как в Postgres
      end = x.toISOString().slice(0, 10)
    }
    return end
  })()
  const total = pays.reduce((s, p) => s + p.amount_cents, 0)
  const last = pays[0]?.paid_on
  const linked = profiles.find((p) => p.id === m.profile_id)

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const link = (profileId) =>
    run(async () => {
      const { error: e } = await supabase.rpc('link_member', { p_member: m.id, p_profile: profileId || null })
      if (e) throw e
    })

  const addPayment = () =>
    run(async () => {
      const cents = Math.round(Number(String(form.amount).replace(',', '.')) * 100)
      if (!(cents > 0)) throw new Error(t('Введите сумму'))
      const row = {
        member_id: m.id,
        paid_on: form.date || today,
        amount_cents: cents,
        kind: form.kind,
        method: form.method,
        // время в описании — чтобы две одинаковые оплаты за день не считались дублем
        description: `${form.method === 'cash' ? 'Наличные тренеру' : 'Перевод'} ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
      }
      const label = `${formatPrice(cents)} ${KIND[form.kind] ?? ''} · ${m.first_name} ${m.last_name}`
      const { error: e } = navigator.onLine ? await supabase.from('member_payments').insert(row) : { error: { message: 'Failed to fetch' } }
      if (e && isNetworkError(e)) {
        // Нет интернета — оплата сохранена на телефоне и уйдёт на сервер сама
        enqueue('member_payment', { row }, label, me?.id)
        setForm((f) => ({ ...f, amount: '', date: today }))
        throw new Error(t('Нет интернета: оплата сохранена на телефоне и отправится сама.'))
      }
      if (e) throw e
      setForm((f) => ({ ...f, amount: '', date: today }))
    })

  return (
    <li className="py-3">
      <div className="flex w-full items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {/* Имя — переход в карточку ученика */}
            <Link to={`/admin/member/${m.id}`} className="hover:text-accent hover:underline">
              {m.first_name} {m.last_name}
            </Link>
            {linked &&
              (linked.approved_at ? (
                <ApprovedMark approved className="ml-2" />
              ) : (
                <span className="ml-2 text-xs text-emerald-400">{t('● в приложении')}</span>
              ))}
          </p>
          {/* Зарегистрирован, но тренер ещё не подтвердил — кнопка прямо в списке */}
          {linked && !linked.approved_at && (
            <ApproveButton athlete={linked} compact onChange={(at) => onProfileChange?.(linked.id, at)} />
          )}
          <p className="truncate text-xs text-neutral-500">
            {[STATUS[m.status], m.discipline && DISCIPLINES[m.discipline], m.parent_name && t('родитель: {name}', { name: m.parent_name }),
              m.rank_override && RANKS[m.rank_override - 1]?.title,
              m.single_price_cents && t('разовая {price}', { price: formatPrice(m.single_price_cents) })].filter(Boolean).join(' · ')}
          </p>
          {membership?.valid_until && <MembershipLine row={membership} className="block truncate text-xs" />}
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title={t('Оплаты и связка с аккаунтом')}
          className="shrink-0 rounded-md px-2 py-1 text-right hover:bg-white/5"
        >
          <p className="font-display text-lg">{formatPrice(total)} <span className="text-xs text-neutral-500">{open ? '▴' : '▾'}</span></p>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">
            {t('{n} опл.', { n: pays.length })}{last ? ` · ${day(last)}` : ''}
          </p>
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 rounded-md border border-line p-3 text-sm">
          {m.notes && <p className="text-neutral-400">{m.notes}</p>}
          {(m.phone || m.aliases?.length > 0) && (
            <p className="text-xs text-neutral-500">
              {m.phone && <a href={`tel:+${m.phone}`} className="text-neutral-300 hover:text-white">+{m.phone}</a>}
              {m.phone && m.aliases?.length > 0 && ' · '}
              {m.aliases?.length > 0 && <>{t('в группе: {names}', { names: m.aliases.join(', ') })}</>}
            </p>
          )}

          <label className="block">
            <span className="label">{t('Аккаунт в приложении')}</span>
            <select className="input" value={m.profile_id ?? ''} disabled={busy} onChange={(e) => link(e.target.value)}>
              <option value="">{t('— не связан —')}</option>
              {profiles
                .filter((p) => p.id === m.profile_id || !linkedIds.has(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                ))}
            </select>
          </label>

          <div>
            <span className="label">{t('Записать оплату')}</span>
            <div className="flex flex-wrap gap-2">
              <input
                className="input !w-24"
                inputMode="decimal"
                placeholder="€"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
              <select className="input !w-auto" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {Object.entries(KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select className="input !w-auto" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                <option value="cash">{t('наличные')}</option>
                <option value="bank">{t('перевод')}</option>
              </select>
              <input
                type="date"
                className="input !w-auto"
                title={t('С какого числа считать абонемент')}
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
              <button type="button" onClick={addPayment} disabled={busy} className="btn-primary disabled:opacity-60">{t('Записать')}</button>
            </div>
            {form.kind === 'membership' && (
              <p className="mt-1 text-xs text-neutral-500">
                {t('Месяц от даты оплаты (или от конца действующего).')}
                {untilAfter && <> {t('Будет действовать до {date}', { date: untilAfter.split('-').reverse().join('.') })}</>}
              </p>
            )}
          </div>

          <div>
            <span className="label">{t('Особая цена разовой (пусто — обычная)')}</span>
            <div className="flex gap-2">
              <input
                className="input !w-24"
                inputMode="decimal"
                placeholder="€"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <button
                type="button"
                disabled={busy}
                className="btn-outline disabled:opacity-60"
                onClick={() =>
                  run(async () => {
                    const cents = price.trim() ? Math.round(Number(price.replace(',', '.')) * 100) : null
                    if (cents !== null && !(cents > 0)) throw new Error(t('Введите цену'))
                    const { error: e } = await supabase.from('club_members').update({ single_price_cents: cents }).eq('id', m.id)
                    if (e) throw e
                  })
                }
              >
                {t('Сохранить')}
              </button>
            </div>
          </div>

          {error && <p className="text-accent">{error}</p>}

          {pays.length > 0 && (
            <ul className="max-h-56 divide-y divide-line overflow-y-auto">
              {pays.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-1.5">
                  <span className="truncate text-neutral-300">
                    {day(p.paid_on)} · {KIND[p.kind]}{p.method === 'cash' ? ` · ${t('нал.')}` : ''}
                    {p.payer_name && p.payer_name.toLowerCase() !== `${m.first_name} ${m.last_name}`.toLowerCase() &&
                      <span className="text-neutral-500"> · {p.payer_name}</span>}
                  </span>
                  <span className="shrink-0">{formatPrice(p.amount_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

function NewMember({ onAdded }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', discipline: '', parent_name: '' })
  const [error, setError] = useState('')
  const save = async (e) => {
    e.preventDefault()
    setError('')
    const { error: err } = await supabase.from('club_members').insert({
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      discipline: form.discipline || null,
      parent_name: form.parent_name.trim() || null,
    })
    if (err) return setError(err.message)
    setForm({ first_name: '', last_name: '', discipline: '', parent_name: '' })
    onAdded()
  }
  return (
    <form onSubmit={save} className="grid gap-2 border-t border-line pt-3 sm:grid-cols-5">
      <input className="input" required placeholder={t('Имя')} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
      <input className="input" required placeholder={t('Фамилия')} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
      <select className="input" value={form.discipline} onChange={(e) => setForm({ ...form, discipline: e.target.value })}>
        <option value="">{t('Направление —')}</option>
        {Object.entries(DISCIPLINES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input className="input" placeholder={t('Родитель (если ребёнок)')} value={form.parent_name} onChange={(e) => setForm({ ...form, parent_name: e.target.value })} />
      <button className="btn-primary">{t('Добавить')}</button>
      {error && <p className="text-sm text-accent sm:col-span-5">{error}</p>}
    </form>
  )
}

export default function AdminMembers({ profiles, onProfileChange }) {
  const [members, setMembers] = useState(null)
  const [filter, setFilter] = useState('active')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [memberships, setMemberships] = useState({}) // member_id → строка membership_overview
  const [contacts, setContacts] = useState([]) // club_contacts: телефон родителя → ученик

  const load = useCallback(async () => {
    cached('admin-memberships', loadMemberships)
      .then((rows) => setMemberships(Object.fromEntries(rows.filter((r) => r.member_id).map((r) => [r.member_id, r]))))
      .catch(() => setMemberships({}))
    try {
      // Без интернета — последний сохранённый список
      const { data, contacts: c } = await cached('admin-members', async () => {
        const { data, error: e } = await supabase
          .from('club_members')
          .select('*, member_payments(id, paid_on, amount_cents, kind, method, payer_name, description, ledger)')
          .order('last_name')
          .order('paid_on', { referencedTable: 'member_payments', ascending: false })
        if (e) throw e
        // Контакты (родители и т.п.) — если таблицы нет или ошибка, просто без них.
        const { data: c } = await supabase.from('club_contacts').select('phone, member_id').not('member_id', 'is', null)
        return { data, contacts: c ?? [] }
      })
      setContacts(c)
      setMembers(data)
    } catch (e) {
      setError(friendlyError(e))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const linkedIds = useMemo(() => new Set((members ?? []).map((m) => m.profile_id).filter(Boolean)), [members])
  const approvedIds = useMemo(() => new Set((profiles ?? []).filter((p) => p.approved_at).map((p) => p.id)), [profiles])

  // Ребёнок — только если у него записан родитель. Контакт из WhatsApp — это обычно
  // телефон самого ученика, по нему взрослые раньше ошибочно попадали в «Дети и родители».
  const isKid = useCallback((m) => Boolean(m.parent_name), [])
  const FILTERS = useMemo(
    () => ({
      active: (m) => ['regular', 'occasional'].includes(m.status),
      regular: (m) => m.status === 'regular',
      occasional: (m) => m.status === 'occasional',
      kids: (m) => m.status !== 'left' && isKid(m),
      paid: (m) => memberships[m.id]?.active,
      in_app: (m) => Boolean(m.profile_id),
      not_approved: (m) => Boolean(m.profile_id) && !approvedIds.has(m.profile_id),
      no_app: (m) => m.status !== 'left' && !m.profile_id,
      one_time: (m) => m.status === 'one_time',
      left: (m) => m.status === 'left',
      all: () => true,
    }),
    [memberships, isKid, approvedIds],
  )

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (members ?? [])
      .filter(FILTERS[filter] ?? FILTERS.active)
      .filter((m) => !s || `${m.first_name} ${m.last_name} ${m.parent_name ?? ''} ${(m.aliases ?? []).join(' ')} ${m.phone ?? ''}`.toLowerCase().includes(s))
  }, [members, filter, q, FILTERS])

  if (error) return <p className="rounded-md border border-accent p-3 text-sm text-accent">{t('Ученики клуба: {error}', { error })}</p>
  if (!members) return null

  // Касса тренера (слой 47) в бюджет клуба не входит.
  const total = members.reduce((s, m) => s + (m.member_payments ?? []).filter((p) => p.ledger !== 'coach').reduce((a, p) => a + p.amount_cents, 0), 0)

  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="label">{t('Все ученики клуба')}</p>
          <h2 className="text-xl">{t('Ученики и оплаты')}</h2>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl">{members.length}</p>
          {/* Сколько из списка уже зарегистрированы в приложении и сколько подтверждено */}
          <button type="button" onClick={() => setFilter('in_app')} className="whitespace-nowrap text-xs text-emerald-400 hover:underline">
            {t('{n} в приложении · {k} ✓', {
              n: members.filter((m) => m.profile_id).length,
              k: members.filter((m) => m.profile_id && approvedIds.has(m.profile_id)).length,
            })}
          </button>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">{t('{sum} всего', { sum: formatPrice(total) })}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="input min-w-40 flex-1" type="search" placeholder={t('Поиск…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {[
            ['active', t('Постоянные и иногда')],
            ['regular', t('Постоянные')],
            ['occasional', t('Иногда')],
            ['kids', t('Дети и родители')],
            ['paid', t('С абонементом')],
            ['in_app', t('В приложении')],
            ['not_approved', t('В приложении, не подтверждены')],
            ['no_app', t('Ещё не в приложении')],
            ['one_time', t('Были раз')],
            ['left', t('Ушли')],
            ['all', t('Все')],
          ].map(([v, l]) => (
            <option key={v} value={v}>{l} · {members.filter(FILTERS[v]).length}</option>
          ))}
        </select>
      </div>

      <LinkSuggestions members={members} profiles={profiles} linkedIds={linkedIds} contacts={contacts} onChanged={load} />

      <ul className="divide-y divide-line">
        {list.map((m) => (
          <MemberRow key={m.id} m={m} profiles={profiles} linkedIds={linkedIds} membership={memberships[m.id]} onChanged={load} onProfileChange={onProfileChange} />
        ))}
      </ul>

      <NewMember onAdded={load} />
    </section>
  )
}

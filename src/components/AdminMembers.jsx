import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApprovedMark } from './Approved.jsx'
import { MembershipLine, loadMemberships } from './AdminMemberships.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { formatPrice } from '../lib/payments.js'
import { RANKS, DISCIPLINES } from '../lib/ranks.js'

// CRM: все ученики клуба, в том числе без аккаунта в приложении,
// с историей оплат вне приложения (банк, наличные). Связка с аккаунтом —
// функция link_member (ранг и направление переносятся в профиль).

const STATUS = { regular: 'Постоянный', occasional: 'Иногда', one_time: 'Был раз', left: 'Ушёл' }
const KIND = {
  training: 'тренировка', membership: 'абонемент', pack: 'пакет', individual: 'индивид.',
  uniform: 'форма', donation: 'пожертвование', other: 'другое',
}
// Нормализация имён для поиска совпадений: латиница без диакритики,
// кириллица → латиница (Андрей ≈ Andrejs, Ņikita ≈ Никита).
const CYR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'z',з:'z',и:'i',й:'j',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'c',ш:'s',щ:'s',ъ:'',ы:'i',ь:'',э:'e',ю:'ju',я:'ja' }
const norm = (t) =>
  (t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[а-яё]/g, (c) => CYR[c] ?? c).replace(/[^a-z ]/g, ' ')
const stem = (w) => w.replace(/(s|is|js|ijs)$/, '').slice(0, 5) // Andrejs/Андрей → andre
const tokens = (t) => norm(t).split(/\s+/).filter((w) => w.length > 1).map(stem)
const matchScore = (profile, m) => {
  const pt = tokens(`${profile.first_name} ${profile.last_name}`)
  const names = [`${m.first_name} ${m.last_name}`, ...(m.aliases ?? [])]
  let best = 0
  for (const n of names) {
    const mt = tokens(n)
    if (!mt.length) continue
    const hit = mt.filter((w) => pt.includes(w)).length
    best = Math.max(best, hit / Math.max(mt.length, pt.length))
  }
  return best
}

/** Аккаунты в приложении, не связанные с учеником клуба, + кандидаты по имени. */
function LinkSuggestions({ members, profiles, linkedIds, onChanged }) {
  const [busy, setBusy] = useState(null)
  const unlinked = profiles.filter((p) => !linkedIds.has(p.id))
  if (!unlinked.length) return null
  const free = members.filter((m) => !m.profile_id)

  const link = async (memberId, profileId) => {
    setBusy(profileId)
    await supabase.rpc('link_member', { p_member: memberId, p_profile: profileId })
    await onChanged()
    setBusy(null)
  }

  return (
    <div className="space-y-2 rounded-md border border-accent/40 p-3">
      <p className="label">Новые в приложении — с кем связать</p>
      {unlinked.map((p) => {
        const cands = free
          .map((m) => ({ m, s: matchScore(p, m) }))
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
              cands.map(({ m }) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy === p.id}
                  onClick={() => link(m.id, p.id)}
                  className="rounded border border-line px-2 py-0.5 hover:border-accent disabled:opacity-50"
                >
                  {m.first_name} {m.last_name}
                </button>
              ))
            ) : (
              <span className="text-neutral-500">совпадений нет — выберите вручную в списке ниже</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

const day = (d) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

function MemberRow({ m, profiles, linkedIds, membership, onChanged }) {
  const [price, setPrice] = useState(m.single_price_cents ? String(m.single_price_cents / 100) : '')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ amount: '', kind: 'training', method: 'cash' })
  const pays = m.member_payments ?? []
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
      if (!(cents > 0)) throw new Error('Введите сумму')
      const { error: e } = await supabase.from('member_payments').insert({
        member_id: m.id,
        paid_on: new Date().toISOString().slice(0, 10),
        amount_cents: cents,
        kind: form.kind,
        method: form.method,
        // время в описании — чтобы две одинаковые оплаты за день не считались дублем
        description: `${form.method === 'cash' ? 'Наличные тренеру' : 'Перевод'} ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
      })
      if (e) throw e
      setForm((f) => ({ ...f, amount: '' }))
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
                <span className="ml-2 text-xs text-emerald-400">● в приложении</span>
              ))}
          </p>
          <p className="truncate text-xs text-neutral-500">
            {[STATUS[m.status], m.discipline && DISCIPLINES[m.discipline], m.parent_name && `родитель: ${m.parent_name}`,
              m.rank_override && RANKS[m.rank_override - 1]?.title,
              m.single_price_cents && `разовая ${formatPrice(m.single_price_cents)}`].filter(Boolean).join(' · ')}
          </p>
          {membership?.valid_until && <MembershipLine row={membership} className="block truncate text-xs" />}
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title="Оплаты и связка с аккаунтом"
          className="shrink-0 rounded-md px-2 py-1 text-right hover:bg-white/5"
        >
          <p className="font-display text-lg">{formatPrice(total)} <span className="text-xs text-neutral-500">{open ? '▴' : '▾'}</span></p>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">
            {pays.length} опл.{last ? ` · ${day(last)}` : ''}
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
              {m.aliases?.length > 0 && <>в группе: {m.aliases.join(', ')}</>}
            </p>
          )}

          <label className="block">
            <span className="label">Аккаунт в приложении</span>
            <select className="input" value={m.profile_id ?? ''} disabled={busy} onChange={(e) => link(e.target.value)}>
              <option value="">— не связан —</option>
              {profiles
                .filter((p) => p.id === m.profile_id || !linkedIds.has(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                ))}
            </select>
          </label>

          <div>
            <span className="label">Записать оплату (сегодня)</span>
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
                <option value="cash">наличные</option>
                <option value="bank">перевод</option>
              </select>
              <button type="button" onClick={addPayment} disabled={busy} className="btn-primary disabled:opacity-60">Записать</button>
            </div>
            {form.kind === 'membership' && (
              <p className="mt-1 text-xs text-neutral-500">Абонемент будет действовать месяц с сегодняшнего дня (или с конца текущего).</p>
            )}
          </div>

          <div>
            <span className="label">Особая цена разовой (пусто — обычная)</span>
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
                    if (cents !== null && !(cents > 0)) throw new Error('Введите цену')
                    const { error: e } = await supabase.from('club_members').update({ single_price_cents: cents }).eq('id', m.id)
                    if (e) throw e
                  })
                }
              >
                Сохранить
              </button>
            </div>
          </div>

          {error && <p className="text-accent">{error}</p>}

          {pays.length > 0 && (
            <ul className="max-h-56 divide-y divide-line overflow-y-auto">
              {pays.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-1.5">
                  <span className="truncate text-neutral-300">
                    {day(p.paid_on)} · {KIND[p.kind]}{p.method === 'cash' ? ' · нал.' : ''}
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
      <input className="input" required placeholder="Имя" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
      <input className="input" required placeholder="Фамилия" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
      <select className="input" value={form.discipline} onChange={(e) => setForm({ ...form, discipline: e.target.value })}>
        <option value="">Направление —</option>
        {Object.entries(DISCIPLINES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input className="input" placeholder="Родитель (если ребёнок)" value={form.parent_name} onChange={(e) => setForm({ ...form, parent_name: e.target.value })} />
      <button className="btn-primary">Добавить</button>
      {error && <p className="text-sm text-accent sm:col-span-5">{error}</p>}
    </form>
  )
}

export default function AdminMembers({ profiles }) {
  const [members, setMembers] = useState(null)
  const [filter, setFilter] = useState('active')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [memberships, setMemberships] = useState({}) // member_id → строка membership_overview

  const load = useCallback(async () => {
    loadMemberships()
      .then((rows) => setMemberships(Object.fromEntries(rows.filter((r) => r.member_id).map((r) => [r.member_id, r]))))
      .catch(() => setMemberships({}))
    const { data, error: e } = await supabase
      .from('club_members')
      .select('*, member_payments(id, paid_on, amount_cents, kind, method, payer_name, description)')
      .order('last_name')
      .order('paid_on', { referencedTable: 'member_payments', ascending: false })
    if (e) return setError(e.message)
    setMembers(data)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const linkedIds = useMemo(() => new Set((members ?? []).map((m) => m.profile_id).filter(Boolean)), [members])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (members ?? [])
      .filter((m) =>
        filter === 'paid'
          ? memberships[m.id]?.active
          : filter === 'active'
            ? ['regular', 'occasional'].includes(m.status)
            : filter === 'all' || m.status === filter,
      )
      .filter((m) => !s || `${m.first_name} ${m.last_name} ${m.parent_name ?? ''} ${(m.aliases ?? []).join(' ')} ${m.phone ?? ''}`.toLowerCase().includes(s))
  }, [members, filter, q, memberships])

  if (error) return <p className="rounded-md border border-accent p-3 text-sm text-accent">Ученики клуба: {error}</p>
  if (!members) return null

  const total = members.reduce((s, m) => s + (m.member_payments ?? []).reduce((a, p) => a + p.amount_cents, 0), 0)

  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="label">Все ученики клуба</p>
          <h2 className="text-xl">Ученики и оплаты</h2>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl">{members.length}</p>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">{formatPrice(total)} всего</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="input flex-1" type="search" placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="active">Постоянные и иногда</option>
          <option value="paid">С абонементом</option>
          <option value="one_time">Были раз</option>
          <option value="all">Все</option>
        </select>
      </div>

      <LinkSuggestions members={members} profiles={profiles} linkedIds={linkedIds} onChanged={load} />

      <ul className="divide-y divide-line">
        {list.map((m) => (
          <MemberRow key={m.id} m={m} profiles={profiles} linkedIds={linkedIds} membership={memberships[m.id]} onChanged={load} />
        ))}
      </ul>

      <NewMember onAdded={load} />
    </section>
  )
}

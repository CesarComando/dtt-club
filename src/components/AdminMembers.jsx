import { useCallback, useEffect, useMemo, useState } from 'react'
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
const day = (d) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

function MemberRow({ m, profiles, linkedIds, onChanged }) {
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
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {m.first_name} {m.last_name}
            {linked && <span className="ml-2 text-xs text-emerald-400">● в приложении</span>}
          </p>
          <p className="truncate text-xs text-neutral-500">
            {[STATUS[m.status], m.discipline && DISCIPLINES[m.discipline], m.parent_name && `родитель: ${m.parent_name}`,
              m.rank_override && RANKS[m.rank_override - 1]?.title].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-lg">{formatPrice(total)}</p>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">
            {pays.length} опл.{last ? ` · ${day(last)}` : ''}
          </p>
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-md border border-line p-3 text-sm">
          {m.notes && <p className="text-neutral-400">{m.notes}</p>}

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

  const load = useCallback(async () => {
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
      .filter((m) => (filter === 'active' ? ['regular', 'occasional'].includes(m.status) : filter === 'all' || m.status === filter))
      .filter((m) => !s || `${m.first_name} ${m.last_name} ${m.parent_name ?? ''}`.toLowerCase().includes(s))
  }, [members, filter, q])

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
          <option value="one_time">Были раз</option>
          <option value="all">Все</option>
        </select>
      </div>

      <ul className="divide-y divide-line">
        {list.map((m) => (
          <MemberRow key={m.id} m={m} profiles={profiles} linkedIds={linkedIds} onChanged={load} />
        ))}
      </ul>

      <NewMember onAdded={load} />
    </section>
  )
}

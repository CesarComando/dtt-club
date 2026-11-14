import { useCallback, useEffect, useMemo, useState } from 'react'
import { addCoachPayment, deleteCoachPayment, loadCoachLedger, loadCoachMembers } from '../lib/coachCash.js'
import { formatPrice } from '../lib/payments.js'
import { t, locale } from '../lib/i18n.jsx'

// CRM → «Касса» (слой 47).
// Помощник тренера: вносит оплаты своих учеников, видит свою кассу (собрано / сдано главному тренеру).
// Главный тренер: видит кассы всех тренеров (только просмотр и удаление ошибочных записей).
// Эти оплаты продлевают ученику абонемент, но в бюджет клуба не входят.

const TZ = 'Europe/Riga'
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const monthKey = (d) => d.slice(0, 7)
const monthTitle = (key) => {
  const s = new Date(`${key}-15T12:00:00`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1).replace(' г.', '')
}
const dayText = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
const KIND = { training: t('Тренировка'), membership: t('Абонемент'), individual: t('Индивидуальная'), pack: t('Пакет') }
const EMPTY = () => ({ member: '', amount: '', date: today(), method: 'cash', kind: 'training', note: '' })

export default function CoachCash({ isAdmin }) {
  const [rows, setRows] = useState(null)
  const [members, setMembers] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [q, setQ] = useState('')
  const [month, setMonth] = useState(monthKey(today()))
  const [coach, setCoach] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const load = useCallback(async () => {
    const [l, m] = await Promise.all([loadCoachLedger(), isAdmin ? Promise.resolve([]) : loadCoachMembers()])
    setRows(l)
    setMembers(m)
  }, [isAdmin])

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])

  const coaches = useMemo(() => {
    const map = new Map()
    ;(rows ?? []).forEach((r) => r.coach_id && map.set(r.coach_id, r.coach_name))
    return [...map.entries()]
  }, [rows])

  const months = useMemo(() => {
    const set = new Set((rows ?? []).map((r) => monthKey(r.paid_on)))
    set.add(monthKey(today()))
    return [...set].sort().reverse()
  }, [rows])

  const view = useMemo(() => {
    const mine = (rows ?? []).filter((r) => coach === 'all' || r.coach_id === coach)
    const inMonth = month === 'all' ? mine : mine.filter((r) => monthKey(r.paid_on) === month)
    const sum = (list, entry) => list.filter((r) => r.entry === entry).reduce((s, r) => s + r.amount_cents, 0)
    return {
      list: inMonth,
      collected: sum(inMonth, 'income'),
      handed: sum(inMonth, 'handover'),
      // за всё время: сколько собрано и сколько из этого уже сдано главному тренеру
      totalCollected: sum(mine, 'income'),
      totalHanded: sum(mine, 'handover'),
    }
  }, [rows, month, coach])

  const found = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return members.filter((m) => `${m.first_name} ${m.last_name}`.toLowerCase().includes(s)).slice(0, 8)
  }, [q, members])
  const picked = members.find((m) => m.id === form.member)

  const save = async (e) => {
    e.preventDefault()
    const cents = Math.round(parseFloat(String(form.amount).replace(',', '.')) * 100)
    if (!form.member) return setError(t('Выберите ученика'))
    if (!cents || cents <= 0) return setError(t('Укажите сумму'))
    setBusy(true)
    setError('')
    setDone('')
    try {
      await addCoachPayment({ ...form, cents })
      setDone(t('Записано: {name} — {sum}', { name: `${picked.first_name} ${picked.last_name}`, sum: formatPrice(cents) }))
      setForm(EMPTY())
      setQ('')
      await load()
    } catch (e2) {
      setError(e2.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (r) => {
    if (!window.confirm(t('Удалить запись: {name} — {sum}?', { name: r.member_name, sum: formatPrice(r.amount_cents) }))) return
    try {
      await deleteCoachPayment(r.id)
      await load()
    } catch (e2) {
      setError(e2.message)
    }
  }

  if (!rows && !error) return null

  return (
    <div className="space-y-4">
      <section className="card space-y-1">
        <p className="label">{isAdmin ? t('Кассы тренеров') : t('Моя касса')}</p>
        <p className="text-sm text-neutral-400">
          {isAdmin
            ? t('Оплаты, которые помощники тренера приняли сами. Ученику они продлевают абонемент, но в бюджет клуба не входят — в бюджете только то, что тренер сдал вам.')
            : t('Здесь вы записываете оплаты своих учеников. Ученику это продлевает абонемент. Главный тренер видит эту кассу.')}
        </p>
      </section>

      {!isAdmin && (
        <form onSubmit={save} className="card space-y-3">
          <p className="label">{t('Записать оплату')}</p>
          {picked ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
              <span className="font-semibold">
                {picked.first_name} {picked.last_name}
                {picked.free_training && <span className="ml-2 text-xs text-accent">{t('бесплатно')}</span>}
              </span>
              <button type="button" onClick={() => setForm((f) => ({ ...f, member: '' }))} className="text-sm text-neutral-400 hover:text-white">
                {t('Другой')}
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Имя ученика…')} className="input" />
              {found.length > 0 && (
                <div className="divide-y divide-line rounded-md border border-line">
                  {found.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => setForm((f) => ({ ...f, member: m.id }))}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-line/40"
                    >
                      {m.first_name} {m.last_name}
                    </button>
                  ))}
                </div>
              )}
              {q && !found.length && <p className="text-xs text-neutral-500">{t('Нет такого ученика MMA. Если он новый — скажите главному тренеру, чтобы добавил его в список.')}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder={t('Сумма, €')}
              className="input"
            />
            <input type="date" value={form.date} max={today()} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="input" />
            <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} className="input">
              {Object.entries(KIND).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} className="input">
              <option value="cash">{t('Наличные')}</option>
              <option value="bank">{t('Перевод')}</option>
            </select>
          </div>
          <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder={t('Заметка (необязательно)')} className="input" maxLength={200} />
          <button disabled={busy} className="btn-primary w-full">
            {busy ? t('Сохраняю…') : t('Записать')}
          </button>
          {done && <p className="text-sm text-green-400">{done}</p>}
        </form>
      )}

      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>}

      <section className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="input !w-auto">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthTitle(m)}
              </option>
            ))}
            <option value="all">{t('За всё время')}</option>
          </select>
          {isAdmin && coaches.length > 1 && (
            <select value={coach} onChange={(e) => setCoach(e.target.value)} className="input !w-auto">
              <option value="all">{t('Все тренеры')}</option>
              {coaches.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-md border border-line p-3">
            <p className="text-xs text-neutral-400">{t('Собрано')}</p>
            <p className="font-display text-2xl tabular-nums">{formatPrice(view.collected)}</p>
          </div>
          <div className="rounded-md border border-line p-3">
            <p className="text-xs text-neutral-400">{t('Сдано главному тренеру')}</p>
            <p className="font-display text-2xl tabular-nums">{formatPrice(view.handed)}</p>
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          {t('За всё время: собрано {a}, сдано {b}.', { a: formatPrice(view.totalCollected), b: formatPrice(view.totalHanded) })}
        </p>

        {view.list.length ? (
          <ul className="divide-y divide-line text-sm">
            {view.list.map((r) => (
              <li key={`${r.entry}-${r.id}`} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate">
                    {r.entry === 'handover' ? <span className="text-accent">{t('Сдано главному тренеру')}</span> : r.member_name}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {dayText(r.paid_on)}
                    {r.entry === 'income' && ` · ${KIND[r.kind] ?? r.kind} · ${r.method === 'cash' ? t('наличные') : t('перевод')}`}
                    {isAdmin && r.coach_name && ` · ${r.coach_name}`}
                    {r.note && ` · ${r.note}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`tabular-nums ${r.entry === 'handover' ? 'text-accent' : ''}`}>
                    {r.entry === 'handover' ? '−' : ''}
                    {formatPrice(r.amount_cents)}
                  </span>
                  {r.entry === 'income' && (
                    <button onClick={() => remove(r)} className="px-1 text-neutral-500 hover:text-accent" aria-label={t('Удалить')}>
                      ×
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-400">{t('За этот период записей нет.')}</p>
        )}
      </section>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { formatPrice } from '../lib/payments.js'

// CRM → «Бюджет» (слой 22). Видит и редактирует только главный тренер (role = 'admin'):
// вкладка показывается только ему, данные защищены RLS (is_admin) в club_expenses / budget_overview.
// Доходы считаются сами (оплаты учеников: переводы на оба счёта + приложение), расходы вносит тренер.

export const CATEGORIES = {
  rent: 'Аренда',
  electricity: 'Электричество',
  water: 'Вода',
  heating: 'Отопление',
  taxes: 'Налоги',
  accountant: 'Бухгалтер',
  inventory: 'Инвентарь',
  other: 'Прочее',
}

const TZ = 'Europe/Riga'
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const monthKey = (d) => d.slice(0, 7)
const monthTitle = (key) => {
  const s = new Date(`${key}-15T12:00:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1).replace(' г.', '')
}
const dayText = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
const EMPTY = { spent_on: today(), category: 'rent', amount: '', note: '' }

export default function AdminBudget() {
  const [months, setMonths] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [month, setMonth] = useState(null) // 'YYYY-MM' или 'all'
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [ov, ex] = await Promise.all([
      supabase.rpc('budget_overview'),
      supabase.from('club_expenses').select('*').order('spent_on', { ascending: false }).order('id', { ascending: false }),
    ])
    if (ov.error) throw ov.error
    if (ex.error) throw ex.error
    setMonths(ov.data.map((r) => ({ ...r, key: monthKey(r.month) })))
    setExpenses(ex.data)
  }, [])

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])

  // По умолчанию — текущий месяц (или последний, где что-то было).
  useEffect(() => {
    if (months && !month) {
      const now = monthKey(today())
      setMonth(months.some((m) => m.key === now) ? now : months[0]?.key ?? now)
    }
  }, [months, month])

  const view = useMemo(() => {
    if (!months) return null
    const rows = month === 'all' ? months : months.filter((m) => m.key === month)
    const sum = (f) => rows.reduce((s, r) => s + f(r), 0)
    const byCat = {}
    rows.forEach((r) => Object.entries(r.by_category ?? {}).forEach(([k, v]) => (byCat[k] = (byCat[k] ?? 0) + v)))
    const income = sum((r) => r.income_bank + r.income_app)
    const spent = sum((r) => r.expenses)
    return { income, bank: sum((r) => r.income_bank), app: sum((r) => r.income_app), spent, byCat, balance: income - spent }
  }, [months, month])

  const list = useMemo(
    () => (month === 'all' ? expenses : expenses.filter((e) => monthKey(e.spent_on) === month)),
    [expenses, month],
  )

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
    } catch (e) {
      setError(/duplicate key/i.test(e.message) ? 'Такой расход уже записан (та же дата, статья, сумма и комментарий).' : e.message)
    } finally {
      setBusy(false)
    }
  }

  const add = (e) => {
    e.preventDefault()
    run(async () => {
      const cents = Math.round(Number(String(form.amount).replace(',', '.')) * 100)
      if (!(cents > 0)) throw new Error('Введите сумму')
      const { error: err } = await supabase.from('club_expenses').insert({
        spent_on: form.spent_on,
        category: form.category,
        amount_cents: cents,
        note: form.note.trim() || null,
      })
      if (err) throw err
      setForm((f) => ({ ...EMPTY, spent_on: f.spent_on, category: f.category }))
      setMonth(monthKey(form.spent_on))
    })
  }

  const remove = (row) => {
    if (!window.confirm(`Удалить расход ${formatPrice(row.amount_cents)} (${CATEGORIES[row.category]})?`)) return
    run(async () => {
      const { error: err } = await supabase.from('club_expenses').delete().eq('id', row.id)
      if (err) throw err
    })
  }

  if (error && !months) return <p className="rounded-md border border-accent p-3 text-sm text-accent">Бюджет: {error}</p>
  if (!months || !view) return <p className="card text-neutral-400">Загружаем…</p>

  const keys = [...new Set([monthKey(today()), ...months.map((m) => m.key)])].sort().reverse()

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label htmlFor="budget-month" className="text-sm text-neutral-400">Период</label>
        <select id="budget-month" value={month ?? ''} onChange={(e) => setMonth(e.target.value)} className="input w-auto">
          {keys.map((k) => (
            <option key={k} value={k}>{monthTitle(k)}</option>
          ))}
          <option value="all">Всё время</option>
        </select>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="card px-2 py-3">
          <p className="font-display text-xl text-emerald-400 sm:text-2xl">{formatPrice(view.income)}</p>
          <p className="text-[11px] uppercase tracking-wider text-neutral-400">Доходы</p>
        </div>
        <div className="card px-2 py-3">
          <p className="font-display text-xl text-accent sm:text-2xl">{formatPrice(view.spent)}</p>
          <p className="text-[11px] uppercase tracking-wider text-neutral-400">Расходы</p>
        </div>
        <div className="card px-2 py-3">
          <p className={`font-display text-xl sm:text-2xl ${view.balance < 0 ? 'text-accent' : 'text-white'}`}>
            {view.balance < 0 ? '−' : ''}{formatPrice(Math.abs(view.balance))}
          </p>
          <p className="text-[11px] uppercase tracking-wider text-neutral-400">Итог</p>
        </div>
      </div>

      <section className="card space-y-2 text-sm">
        <h2 className="text-xl">Откуда и куда</h2>
        <p className="flex justify-between"><span className="text-neutral-400">Оплаты учеников (перевод / наличные)</span><span>{formatPrice(view.bank)}</span></p>
        <p className="flex justify-between"><span className="text-neutral-400">Оплаты в приложении</span><span>{formatPrice(view.app)}</span></p>
        <div className="border-t border-line pt-2">
          {Object.entries(CATEGORIES).map(([k, label]) => (
            <p key={k} className="flex justify-between">
              <span className="text-neutral-400">{label}</span>
              <span className={view.byCat[k] ? '' : 'text-neutral-600'}>{view.byCat[k] ? `−${formatPrice(view.byCat[k])}` : '—'}</span>
            </p>
          ))}
        </div>
      </section>

      <form onSubmit={add} className="card space-y-3">
        <h2 className="text-xl">Добавить расход</h2>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="exp-date">Дата</label>
            <input id="exp-date" type="date" required value={form.spent_on} onChange={(e) => setForm({ ...form, spent_on: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="exp-amount">Сумма, €</label>
            <input id="exp-amount" inputMode="decimal" required placeholder="0,00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="input" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Статья расхода">
          {Object.entries(CATEGORIES).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={form.category === k}
              onClick={() => setForm({ ...form, category: k })}
              className={`rounded-md border px-3 py-1.5 text-sm ${form.category === k ? 'border-accent bg-accent/10 text-white' : 'border-line text-neutral-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input aria-label="Комментарий" placeholder="Комментарий (необязательно): счёт №, за какой месяц…" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="input" />
        {error && <p className="text-sm text-accent">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">{busy ? 'Сохраняем…' : 'Записать расход'}</button>
      </form>

      <section className="card">
        <h2 className="mb-2 text-xl">Расходы{month === 'all' ? '' : ` · ${monthTitle(month)}`}</h2>
        {list.length === 0 ? (
          <p className="text-sm text-neutral-400">Расходов за этот период нет.</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p>{CATEGORIES[r.category]} <span className="text-neutral-500">· {dayText(r.spent_on)}</span></p>
                  {r.note && <p className="truncate text-xs text-neutral-500">{r.note}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-display">−{formatPrice(r.amount_cents)}</span>
                  <button type="button" onClick={() => remove(r)} disabled={busy} aria-label="Удалить расход" className="px-1 text-neutral-500 hover:text-accent">✕</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

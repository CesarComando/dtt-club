import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { formatPrice } from '../lib/payments.js'
import { t, locale, tData } from '../lib/i18n.jsx'

// CRM → «Бюджет» (слой 22). Видит и редактирует только главный тренер (role = 'admin'):
// вкладка показывается только ему, данные защищены RLS (is_admin) в club_expenses / budget_overview.
// Доходы считаются сами (оплаты учеников: переводы на оба счёта + приложение), расходы вносит тренер.

// Аналитика (слой 50) — отдельным файлом, грузится только по нажатию.
const AdminAnalytics = lazy(() => import('./AdminAnalytics.jsx'))

export const CATEGORIES = {
  rent: t('Аренда'),
  electricity: t('Электричество'),
  water: t('Вода'),
  heating: t('Отопление'),
  taxes: t('Налоги'),
  accountant: t('Бухгалтер'),
  inventory: t('Инвентарь'),
  other: t('Прочее'),
}

// Вид оплаты ученика — как в CRM
const KIND = {
  training: t('тренировка'), membership: t('абонемент'), pack: t('пакет'), individual: t('индивид.'),
  uniform: t('форма'), donation: t('пожертвование'), other: t('другое'),
}

const TZ = 'Europe/Riga'
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const monthKey = (d) => d.slice(0, 7)
const monthTitle = (key) => {
  const s = new Date(`${key}-15T12:00:00`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1).replace(' г.', '')
}
const dayText = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
const EMPTY = { spent_on: today(), category: 'rent', amount: '', note: '' }

export default function AdminBudget() {
  const [view, setView] = useState('budget') // 'budget' | 'analytics'
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label={t('Бюджет или аналитика')}>
        {[['budget', t('Деньги')], ['analytics', t('Аналитика')]].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={`rounded-md border px-3 py-2 font-display text-sm uppercase tracking-wider ${
              view === id ? 'border-accent bg-accent/10 text-white' : 'border-line text-neutral-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'budget' ? (
        <Budget />
      ) : (
        <Suspense fallback={<p className="card text-neutral-400">{t('Загружаем…')}</p>}>
          <AdminAnalytics />
        </Suspense>
      )}
    </div>
  )
}

function Budget() {
  const [months, setMonths] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [month, setMonth] = useState(null) // 'YYYY-MM' или 'all'
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [incomes, setIncomes] = useState([])
  const [part, setPart] = useState('income') // 'income' | 'expense' | 'all'

  const load = useCallback(async () => {
    const [ov, ex, mp, ap] = await Promise.all([
      supabase.rpc('budget_overview'),
      supabase.from('club_expenses').select('*').order('spent_on', { ascending: false }).order('id', { ascending: false }),
      // Доходы «от кого»: те же источники, что в budget_overview (касса клуба + оплаты в приложении)
      supabase
        .from('member_payments')
        .select('id, paid_on, amount_cents, kind, method, payer_name, member:club_members(id, first_name, last_name, cashbox_of)')
        .eq('ledger', 'club'),
      supabase
        .from('payments')
        .select('id, created_at, amount_cents, refunded_cents, note, product:payment_products(title), user:profiles(first_name, last_name)')
        .eq('status', 'paid'),
    ])
    for (const r of [ov, ex, mp, ap]) if (r.error) throw r.error
    setMonths(ov.data.map((r) => ({ ...r, key: monthKey(r.month) })))
    setExpenses(ex.data)
    const name = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ') || t('без имени')
    setIncomes(
      [
        ...mp.data.map((p) => ({
          id: `m${p.id}`,
          date: p.paid_on,
          // Касса тренера — не ученик: идёт в «Другое»
          who: p.member?.cashbox_of ? t('Другое') : name(p.member),
          whoKey: p.member?.cashbox_of ? 'other' : `m${p.member?.id}`,
          payer: p.payer_name,
          kind: p.member?.cashbox_of ? name(p.member) : KIND[p.kind] ?? p.kind,
          method: p.method === 'cash' ? t('наличные') : t('перевод'),
          cents: p.amount_cents,
        })),
        ...ap.data.map((p) => ({
          id: `a${p.id}`,
          date: new Date(p.created_at).toLocaleDateString('en-CA', { timeZone: TZ }),
          who: name(p.user),
          whoKey: `a${name(p.user)}`,
          kind: p.note || tData(p.product?.title) || t('оплата'),
          method: t('приложение'),
          cents: p.amount_cents - (p.refunded_cents ?? 0),
        })),
      ].sort((a, b) => (a.date < b.date ? 1 : -1)),
    )
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
  const incomeList = useMemo(
    () => (month === 'all' ? incomes : incomes.filter((p) => monthKey(p.date) === month)),
    [incomes, month],
  )
  // «От кого»: по ученику, кто принёс больше — сверху
  const byWho = useMemo(() => {
    const g = {}
    incomeList.forEach((p) => {
      const e = (g[p.whoKey] ??= { key: p.whoKey, who: p.who, total: 0, items: [] })
      e.total += p.cents
      e.items.push(p)
    })
    return Object.values(g).sort((a, b) => (a.key === 'other') - (b.key === 'other') || b.total - a.total)
  }, [incomeList])
  // «Всё»: доходы и расходы одной лентой по датам
  const ledger = useMemo(
    () =>
      [
        ...incomeList.map((p) => ({ ...p, sign: 1, title: p.who, sub: `${p.kind} · ${p.method}` })),
        ...list.map((e) => ({ id: `e${e.id}`, date: e.spent_on, cents: e.amount_cents, sign: -1, title: CATEGORIES[e.category], sub: e.note ?? '' })),
      ].sort((a, b) => (a.date === b.date ? b.sign - a.sign : a.date < b.date ? 1 : -1)),
    [incomeList, list],
  )

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
    } catch (e) {
      setError(/duplicate key/i.test(e.message) ? t('Такой расход уже записан (та же дата, статья, сумма и комментарий).') : e.message)
    } finally {
      setBusy(false)
    }
  }

  const add = (e) => {
    e.preventDefault()
    run(async () => {
      const cents = Math.round(Number(String(form.amount).replace(',', '.')) * 100)
      if (!(cents > 0)) throw new Error(t('Введите сумму'))
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
    if (!window.confirm(t('Удалить расход {sum} ({category})?', { sum: formatPrice(row.amount_cents), category: CATEGORIES[row.category] }))) return
    run(async () => {
      const { error: err } = await supabase.from('club_expenses').delete().eq('id', row.id)
      if (err) throw err
    })
  }

  if (error && !months) return <p className="rounded-md border border-accent p-3 text-sm text-accent">{t('Бюджет: {error}', { error })}</p>
  if (!months || !view) return <p className="card text-neutral-400">{t('Загружаем…')}</p>

  const keys = [...new Set([monthKey(today()), ...months.map((m) => m.key)])].sort().reverse()

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label htmlFor="budget-month" className="text-sm text-neutral-400">{t('Период')}</label>
        <select id="budget-month" value={month ?? ''} onChange={(e) => setMonth(e.target.value)} className="input w-auto">
          {keys.map((k) => (
            <option key={k} value={k}>{monthTitle(k)}</option>
          ))}
          <option value="all">{t('Всё время')}</option>
        </select>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="card px-2 py-3">
          <p className="font-display text-xl text-emerald-400 sm:text-2xl">{formatPrice(view.income)}</p>
          <p className="text-[11px] uppercase tracking-wider text-neutral-400">{t('Доходы')}</p>
        </div>
        <div className="card px-2 py-3">
          <p className="font-display text-xl text-accent sm:text-2xl">{formatPrice(view.spent)}</p>
          <p className="text-[11px] uppercase tracking-wider text-neutral-400">{t('Расходы')}</p>
        </div>
        <div className="card px-2 py-3">
          <p className={`font-display text-xl sm:text-2xl ${view.balance < 0 ? 'text-accent' : 'text-white'}`}>
            {view.balance < 0 ? '−' : ''}{formatPrice(Math.abs(view.balance))}
          </p>
          <p className="text-[11px] uppercase tracking-wider text-neutral-400">{t('Итог')}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label={t('Доходы, расходы или всё')}>
        {[['income', t('Доходы · от кого')], ['expense', t('Расходы · куда')], ['all', t('Всё')]].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={part === id}
            onClick={() => setPart(id)}
            className={`min-h-10 rounded-md border px-2 py-2 text-sm ${part === id ? 'border-accent bg-accent/10 text-white' : 'border-line text-neutral-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {part === 'income' && (
        <section className="card space-y-2 text-sm">
          <h2 className="text-xl">{t('Доходы · от кого')}</h2>
          <p className="flex justify-between"><span className="text-neutral-400">{t('Оплаты учеников (перевод / наличные)')}</span><span>{formatPrice(view.bank)}</span></p>
          <p className="flex justify-between"><span className="text-neutral-400">{t('Оплаты в приложении')}</span><span>{formatPrice(view.app)}</span></p>
          {byWho.length === 0 ? (
            <p className="border-t border-line pt-2 text-neutral-400">{t('Доходов за этот период нет.')}</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {byWho.map((g) => (
                <li key={g.key} className="py-1.5">
                  <details>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {g.who} <span className="text-neutral-500">· {t('{n} опл.', { n: g.items.length })}</span>
                      </span>
                      <span className="shrink-0 font-display text-emerald-400">+{formatPrice(g.total)}</span>
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-3 text-xs text-neutral-400">
                      {g.items.map((p) => (
                        <li key={p.id} className="flex justify-between gap-3">
                          <span className="min-w-0 truncate">
                            {dayText(p.date)} · {p.kind} · {p.method}
                            {p.payer && <span className="text-neutral-500"> · {p.payer}</span>}
                          </span>
                          <span className="shrink-0">{formatPrice(p.cents)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {part === 'all' && (
        <section className="card text-sm">
          <h2 className="mb-2 text-xl">{t('Всё')}{month === 'all' ? '' : ` · ${monthTitle(month)}`}</h2>
          {ledger.length === 0 ? (
            <p className="text-neutral-400">{t('За этот период ничего нет.')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {ledger.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate">{r.title} <span className="text-neutral-500">· {dayText(r.date)}</span></p>
                    {r.sub && <p className="truncate text-xs text-neutral-500">{r.sub}</p>}
                  </div>
                  <span className={`shrink-0 font-display ${r.sign > 0 ? 'text-emerald-400' : 'text-accent'}`}>
                    {r.sign > 0 ? '+' : '−'}{formatPrice(r.cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {part === 'expense' && (
      <>
      <section className="card space-y-2 text-sm">
        <h2 className="text-xl">{t('Расходы · куда')}</h2>
        {Object.entries(CATEGORIES).map(([k, label]) => (
          <p key={k} className="flex justify-between">
            <span className="text-neutral-400">{label}</span>
            <span className={view.byCat[k] ? '' : 'text-neutral-600'}>{view.byCat[k] ? `−${formatPrice(view.byCat[k])}` : '—'}</span>
          </p>
        ))}
      </section>

      <form onSubmit={add} className="card space-y-3">
        <h2 className="text-xl">{t('Добавить расход')}</h2>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="exp-date">{t('Дата')}</label>
            <input id="exp-date" type="date" required value={form.spent_on} onChange={(e) => setForm({ ...form, spent_on: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="exp-amount">{t('Сумма, €')}</label>
            <input id="exp-amount" inputMode="decimal" required placeholder="0,00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="input" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('Статья расхода')}>
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
        <input aria-label={t('Комментарий')} placeholder={t('Комментарий (необязательно): счёт №, за какой месяц…')} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="input" />
        {error && <p className="text-sm text-accent">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">{busy ? t('Сохраняем…') : t('Записать расход')}</button>
      </form>

      <section className="card">
        <h2 className="mb-2 text-xl">{t('Расходы')}{month === 'all' ? '' : ` · ${monthTitle(month)}`}</h2>
        {list.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('Расходов за этот период нет.')}</p>
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
                  <button type="button" onClick={() => remove(r)} disabled={busy} aria-label={t('Удалить расход')} className="px-1 text-neutral-500 hover:text-accent">✕</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      </>
      )}
    </div>
  )
}

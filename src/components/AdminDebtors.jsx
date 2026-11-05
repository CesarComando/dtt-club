import { useCallback, useEffect, useState } from 'react'
import { formatDay, formatPrice, loadCatalog } from '../lib/payments.js'
import { loadDebtors, recordCashPayment } from '../lib/club-ops.js'

let catalogCache = null
const useCashProducts = () => {
  const [items, setItems] = useState(catalogCache ?? [])
  useEffect(() => {
    if (catalogCache) return
    loadCatalog()
      .then((c) => {
        catalogCache = c.filter((p) => p.kind === 'membership' || p.kind === 'single')
        setItems(catalogCache)
      })
      .catch(() => {})
  }, [])
  return items
}

/** Тренер отмечает оплату наличными: абонемент на месяц или разовая. */
export function CashPayment({ athlete, onDone }) {
  const products = useCashProducts()
  const mine = products.filter((p) => athlete.discipline === 'both' || p.discipline === athlete.discipline)
  const [product, setProduct] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const selected = product || mine[0]?.id || ''

  const save = async () => {
    setBusy(true)
    setMsg('')
    try {
      const until = await recordCashPayment(athlete.id, selected)
      setMsg(until ? `Абонемент оплачен до ${formatDay(until)}` : 'Разовая оплата записана')
      onDone?.()
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!mine.length) return null
  return (
    <div className="space-y-2">
      <span className="label">Оплата наличными</span>
      <div className="flex gap-2">
        <select className="input" value={selected} onChange={(e) => setProduct(e.target.value)} disabled={busy}>
          {mine.map((p) => (
            <option key={p.id} value={p.id}>{p.title} · {formatPrice(p.amount_cents, p.currency)}</option>
          ))}
        </select>
        <button type="button" onClick={save} disabled={busy} className="btn-primary shrink-0 disabled:opacity-60">
          {busy ? '…' : 'Принял'}
        </button>
      </div>
      {msg && <p className="text-xs text-neutral-400" role="status">{msg}</p>}
    </div>
  )
}

/** Список должников в CRM тренера. */
export default function AdminDebtors({ athletes, reloadKey, onPaid }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)

  const load = useCallback(() => {
    loadDebtors()
      .then((d) => {
        setList(d)
        setError('')
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  if (error) return <p className="rounded-md border border-accent p-3 text-sm text-accent">Должники: {error}</p>
  if (!list) return null

  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl">Должники</h2>
        <span className={`font-display text-2xl ${list.length ? 'text-accent' : 'text-neutral-500'}`}>{list.length}</span>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-neutral-400">Все оплатили — долгов нет.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((d) => {
            const athlete = athletes.find((a) => a.id === d.athlete_id) ?? { id: d.athlete_id, discipline: 'both' }
            return (
              <li key={d.athlete_id} className="space-y-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{d.first_name} {d.last_name}</p>
                    <p className="text-sm text-accent">
                      {d.reason}
                      {d.unpaid ? ` · ${d.unpaid} трен.` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(open === d.athlete_id ? null : d.athlete_id)}
                    className="text-xs text-neutral-400 hover:text-white"
                  >
                    {open === d.athlete_id ? 'Скрыть' : 'Оплатил наличными'}
                  </button>
                </div>
                {open === d.athlete_id && (
                  <CashPayment
                    athlete={athlete}
                    onDone={() => {
                      load()
                      onPaid?.()
                    }}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-neutral-500">
        Должник — не прошло списание по карте или за 30 дней тренировок больше, чем оплачено (первая тренировка бесплатно).
      </p>
    </section>
  )
}

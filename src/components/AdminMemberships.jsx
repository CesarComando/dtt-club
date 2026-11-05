import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { formatPrice } from '../lib/payments.js'
import { DISCIPLINES } from '../lib/ranks.js'

// CRM → «Абонементы»: у кого абонемент действует и до какого числа.
// Абонемент — месяц со дня оплаты (раньше оплатил — продлевается с конца прошлого).
// Источники: перевод/наличные из списка клуба, наличные в приложении, карта (Stripe).

export const SOURCE = { bank: 'перевод', cash: 'наличные', card: 'карта' }
const TZ = 'Europe/Riga'
export const untilText = (d) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: TZ })
export const daysLeft = (d) => {
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: TZ }) + 'T00:00:00')
  return Math.round((new Date(`${d}T00:00:00`) - today) / 864e5)
}

export const loadMemberships = async () => {
  const { data, error } = await supabase.rpc('membership_overview', { p_only_me: false })
  if (error) throw error
  return data
}

/** «до 7 декабря · ещё 12 дн.» зелёным / «закончился 10 ноября» красным. */
export function MembershipLine({ row, className = '' }) {
  if (!row?.valid_until) return null
  const d = daysLeft(row.valid_until)
  return (
    <span className={`${row.active ? (d <= 3 ? 'text-amber-400' : 'text-emerald-400') : 'text-accent'} ${className}`}>
      {row.active
        ? `Абонемент до ${untilText(row.valid_until)} · ${d === 0 ? 'последний день' : `ещё ${d} дн.`}`
        : `Абонемент закончился ${untilText(row.valid_until)}`}
      <span className="text-neutral-500"> · {SOURCE[row.source] ?? row.source}</span>
    </span>
  )
}

export default function AdminMemberships() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadMemberships().then(setRows).catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="rounded-md border border-accent p-3 text-sm text-accent">Абонементы: {error}</p>
  if (!rows) return <p className="card text-neutral-400">Загружаем…</p>

  const active = rows.filter((r) => r.active)
  // Закончились за последние 60 дней — кому напомнить продлить.
  const expired = rows.filter((r) => !r.active && r.valid_until && daysLeft(r.valid_until) >= -60)
  const special = rows.filter((r) => r.single_price_cents)

  const href = (r) => (r.member_id ? `/admin/member/${r.member_id}` : `/admin/athlete/${r.profile_id}`)
  const Row = ({ r }) => (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <Link to={href(r)} className="font-semibold hover:text-accent hover:underline">
          {r.first_name} {r.last_name}
        </Link>
        <p className="text-xs">
          <MembershipLine row={r} />
          {r.discipline && <span className="text-neutral-500"> · {DISCIPLINES[r.discipline] ?? r.discipline}</span>}
        </p>
      </div>
    </li>
  )

  return (
    <div className="space-y-4">
      <section className="card space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl">Действующие абонементы</h2>
          <span className="font-display text-2xl text-emerald-400">{active.length}</span>
        </div>
        {active.length ? (
          <ul className="divide-y divide-line">{active.map((r) => <Row key={`${r.member_id}-${r.profile_id}`} r={r} />)}</ul>
        ) : (
          <p className="text-sm text-neutral-400">Сейчас ни у кого нет действующего абонемента.</p>
        )}
      </section>

      <section className="card space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl">Закончились недавно</h2>
          <span className="font-display text-2xl text-accent">{expired.length}</span>
        </div>
        {expired.length ? (
          <ul className="divide-y divide-line">{expired.map((r) => <Row key={`${r.member_id}-${r.profile_id}`} r={r} />)}</ul>
        ) : (
          <p className="text-sm text-neutral-400">За последние 2 месяца никто не выпал.</p>
        )}
      </section>

      {special.length > 0 && (
        <section className="card space-y-1">
          <h2 className="text-lg">Особая цена разовой</h2>
          {special.map((r) => (
            <p key={`${r.member_id}-${r.profile_id}`} className="text-sm">
              <Link to={href(r)} className="hover:text-accent hover:underline">{r.first_name} {r.last_name}</Link>
              <span className="text-emerald-400"> · {formatPrice(r.single_price_cents)} за тренировку</span>
            </p>
          ))}
        </section>
      )}

      <p className="text-xs text-neutral-500">
        Абонемент действует месяц со дня оплаты. Если оплачен раньше, чем закончился прошлый, — новый месяц идёт с конца прошлого.
      </p>
    </div>
  )
}

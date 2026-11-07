import { useEffect, useState } from 'react'
import { loadMembershipReminders, markReminded, prettyPhone, waLink } from '../lib/coach.js'
import { untilText } from './AdminMemberships.jsx'

const message = (r) => {
  const d = r.days_left
  const when =
    d > 1 ? `заканчивается через ${d} дн. (${untilText(r.valid_until)})`
    : d === 1 ? `заканчивается завтра (${untilText(r.valid_until)})`
    : d === 0 ? 'заканчивается сегодня'
    : `закончился ${untilText(r.valid_until)}`
  return `Привет, ${r.first_name}! Твой абонемент в Daugavpils Top Team ${when}. ` +
    'Продлить можно в приложении app.daugavpilstopteam.lv (картой) или переводом / наличными тренеру. До встречи на тренировке! 💪'
}

// «Абонементы» → кому напомнить о продлении (кончается ≤ 3 дн. или закончился ≤ 7 дн. назад).
// Кнопка открывает WhatsApp тренера с готовым текстом и ставит отметку «напомнил».
export default function MembershipReminders() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  const load = () =>
    loadMembershipReminders()
      .then(setRows)
      .catch((e) => setError(e.message.includes('membership_reminders') ? 'Выполните supabase/layer34_coach_tools.sql' : e.message))
  useEffect(() => {
    load()
  }, [])

  if (error) return <p className="rounded-md border border-accent p-3 text-sm text-accent">Напоминания: {error}</p>
  if (!rows?.length) return null

  const remind = (r) => {
    markReminded(r).then(load).catch(() => {})
  }

  return (
    <section className="card space-y-2">
      <p className="label">Напомнить о продлении · {rows.length}</p>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={`${r.member_id ?? r.profile_id}-${r.valid_until}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{r.first_name} {r.last_name}</span>{' '}
              <span className={r.days_left < 0 ? 'text-accent' : 'text-amber-400'}>
                {r.days_left < 0 ? `закончился ${untilText(r.valid_until)}` : r.days_left === 0 ? 'последний день' : `ещё ${r.days_left} дн.`}
              </span>
              {r.reminded_at && (
                <span className="block text-xs text-emerald-400">
                  ✓ напомнил {new Date(r.reminded_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                </span>
              )}
            </span>
            {r.phone ? (
              <a
                href={waLink(r.phone, message(r))}
                target="_blank"
                rel="noopener"
                onClick={() => remind(r)}
                className={`rounded border px-2 py-1 text-xs ${r.reminded_at ? 'border-line text-neutral-400' : 'border-emerald-600 text-emerald-400'} hover:border-emerald-400`}
                title={prettyPhone(r.phone)}
              >
                WhatsApp
              </a>
            ) : (
              <span className="text-xs text-neutral-500">нет телефона</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

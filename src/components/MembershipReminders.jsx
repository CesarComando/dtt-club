import { useEffect, useState } from 'react'
import { loadMembershipReminders, markReminded, prettyPhone, waLink } from '../lib/coach.js'
import { untilText } from './AdminMemberships.jsx'
import { t, locale } from '../lib/i18n.jsx'

const message = (r) => {
  const d = r.days_left
  const when =
    d > 1 ? t('заканчивается через {n} дн. ({date})', { n: d, date: untilText(r.valid_until) })
    : d === 1 ? t('заканчивается завтра ({date})', { date: untilText(r.valid_until) })
    : d === 0 ? t('заканчивается сегодня')
    : t('закончился {date}', { date: untilText(r.valid_until) })
  return t('Привет, {name}! Твой абонемент в Daugavpils Top Team {when}. Продлить можно в приложении app.daugavpilstopteam.lv (картой) или переводом / наличными тренеру. До встречи на тренировке! 💪', { name: r.first_name, when })
}

// «Абонементы» → кому напомнить о продлении (кончается ≤ 3 дн. или закончился ≤ 7 дн. назад).
// Кнопка открывает WhatsApp тренера с готовым текстом и ставит отметку «напомнил».
export default function MembershipReminders() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  const load = () =>
    loadMembershipReminders()
      .then(setRows)
      .catch((e) => setError(e.message.includes('membership_reminders') ? t('Выполните supabase/layer34_coach_tools.sql') : e.message))
  useEffect(() => {
    load()
  }, [])

  if (error) return <p className="rounded-md border border-accent p-3 text-sm text-accent">{t('Напоминания: {error}', { error })}</p>
  if (!rows?.length) return null

  const remind = (r) => {
    markReminded(r).then(load).catch(() => {})
  }

  return (
    <section className="card space-y-2">
      <p className="label">{t('Напомнить о продлении · {n}', { n: rows.length })}</p>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={`${r.member_id ?? r.profile_id}-${r.valid_until}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{r.first_name} {r.last_name}</span>{' '}
              <span className={r.days_left < 0 ? 'text-accent' : 'text-amber-400'}>
                {r.days_left < 0 ? t('закончился {date}', { date: untilText(r.valid_until) }) : r.days_left === 0 ? t('последний день') : t('ещё {n} дн.', { n: r.days_left })}
              </span>
              {r.reminded_at && (
                <span className="block text-xs text-emerald-400">
                  {t('✓ напомнил {date}', { date: new Date(r.reminded_at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) })}
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
              <span className="text-xs text-neutral-500">{t('нет телефона')}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

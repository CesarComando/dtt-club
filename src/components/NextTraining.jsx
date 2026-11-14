import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { activeSection, isKidsSession, seesBoth, useKids, useSection } from '../lib/section.js'
import { bookSession, isFull, loadUpcoming, sessionDay, sessionTime } from '../lib/booking.js'
import { t } from '../lib/i18n.jsx'
import { friendlyError } from '../lib/offline.js'

// Сразу после отметки на тренировке: «Когда следующая?» — запись одним нажатием.
// Показывает до трёх ближайших занятий своего направления; если ученик уже записан — говорит на какое.
export default function NextTraining({ onBooked }) {
  const { profile } = useAuth()
  const chosen = useSection()
  const kids = useKids()
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(null)
  const [booked, setBooked] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    loadUpcoming(7)
      .then((l) => alive && setList(l ?? []))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [])

  if (!list) return null
  const both = seesBoth(profile)
  const section = activeSection(profile, chosen)
  const now = new Date()
  // тот же отбор, что в «Записи на тренировки» (Booking.jsx)
  const mine = list.filter(
    (s) =>
      !s.cancelled &&
      new Date(s.starts_at) > now &&
      (!both || !section || s.discipline === section) &&
      (s.discipline !== 'mma' || isKidsSession(s) === kids),
  )
  const already = booked ?? mine.find((s) => s.is_booked)
  const options = mine.filter((s) => !s.is_booked && !isFull(s)).slice(0, 3)
  if (!already && !options.length) return null

  const book = async (s) => {
    setBusy(s.id)
    setError('')
    try {
      await bookSession(s.id)
      setBooked(s)
      onBooked?.()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  const when = (s) => `${sessionDay(s.starts_at)} · ${sessionTime(s)}`

  return (
    <div className="card space-y-3 !p-4 text-left">
      <p className="font-display text-lg uppercase tracking-wide">{t('Когда следующая?')}</p>
      {already ? (
        <p className="text-sm text-emerald-400">✓ {t('Вы записаны: {when}', { when: when(already) })}</p>
      ) : (
        <>
          <p className="text-sm text-neutral-400">{t('Запишитесь сразу — тренер будет вас ждать.')}</p>
          <div className="space-y-2">
            {options.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={busy != null}
                onClick={() => book(s)}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-line px-4 py-3 text-left hover:border-accent disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block font-display uppercase tracking-wide">{sessionDay(s.starts_at)}</span>
                  <span className="block text-sm text-neutral-400">{sessionTime(s)}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-accent">{busy === s.id ? '…' : t('Записаться')}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="text-sm text-accent">{error}</p>}
    </div>
  )
}

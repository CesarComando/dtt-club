import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { SECTIONS, activeSection, seesBoth, setSection, useSection } from '../lib/section.js'
import { bookSession, cancelBooking, isFull, loadUpcoming, seatsText, sessionDay, sessionTime, shareInvite } from '../lib/booking.js'

// Кабинет ученика: ближайшие тренировки его направления, «Записаться / Отменить».
export default function Booking() {
  const { profile } = useAuth()
  const chosen = useSection()
  const both = seesBoth(profile)
  const section = activeSection(profile, chosen)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [shared, setShared] = useState({}) // session_id → 'Ссылка скопирована' и т.п.

  const refresh = useCallback(async () => {
    try {
      setSessions(await loadUpcoming(7))
    } catch (e) {
      setError('Не удалось загрузить расписание: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = async (s) => {
    setBusy(s.id)
    setError('')
    try {
      const booked = s.is_booked ? await cancelBooking(s.id) : await bookSession(s.id)
      setSessions((list) => list.map((x) => (x.id === s.id ? { ...x, booked, is_booked: !s.is_booked } : x)))
    } catch (e) {
      setError(e.message)
      refresh() // счётчик мог измениться — перечитываем
    } finally {
      setBusy(null)
    }
  }

  const invite = async (s) => {
    setError('')
    try {
      const r = await shareInvite(s)
      if (r !== 'cancelled')
        setShared((m) => ({ ...m, [s.id]: r === 'copied' ? 'Ссылка скопирована — отправьте другу' : 'Приглашение отправлено' }))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg">Запись на тренировки</h2>
        {/* Раздел из входа; кто ходит в оба направления — переключает здесь */}
        {both && (
          <div className="flex gap-1">
            {Object.entries(SECTIONS).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`rounded-full border px-3 py-1 text-xs ${section === id ? 'border-accent bg-accent/15 text-white' : 'border-line text-neutral-400'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>}
      {loading ? (
        <p className="card text-neutral-400">Загружаем расписание…</p>
      ) : sessions.length === 0 ? (
        <p className="card text-neutral-400">На ближайшую неделю тренировок нет.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.filter((s) => !both || !section || s.discipline === section).map((s) => {
            const full = isFull(s) && !s.is_booked
            const started = new Date(s.starts_at) <= new Date()
            const pct = s.capacity ? Math.min(100, Math.round((s.booked / s.capacity) * 100)) : 0
            return (
              <li key={s.id} className={`card flex items-center gap-4 !p-4 ${s.is_booked ? 'border-accent/60' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-display uppercase tracking-wide">
                    {sessionDay(s.starts_at)} · {sessionTime(s)}
                  </p>
                  <p className="truncate text-sm text-neutral-400">{s.title}</p>
                  {s.venue_id !== 'club' && (
                    <p className="text-sm font-semibold text-accent">
                      📍 {s.venue_name}{s.venue_address && `, ${s.venue_address}`}
                    </p>
                  )}
                  <p className={`mt-1 text-xs ${full ? 'text-accent' : 'text-neutral-500'}`}>
                    {s.cancelled ? 'Тренировка отменена' : seatsText(s)}
                  </p>
                  {!s.cancelled && !started && !isFull(s) && (
                    <button type="button" onClick={() => invite(s)} className="mt-1 text-xs font-semibold text-accent hover:underline">
                      {shared[s.id] ?? '＋ Позвать друга'}
                    </button>
                  )}
                  {s.capacity && (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink">
                      <div className={`h-full ${full ? 'bg-accent' : 'bg-white/60'}`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy === s.id || full || started || s.cancelled}
                  onClick={() => toggle(s)}
                  className={`${s.is_booked ? 'btn-outline' : 'btn-primary'} min-w-32 shrink-0 disabled:opacity-50`}
                >
                  {busy === s.id
                    ? '…'
                    : s.is_booked
                      ? 'Отменить'
                      : full
                        ? 'Мест нет'
                        : started
                          ? 'Идёт'
                          : 'Записаться'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

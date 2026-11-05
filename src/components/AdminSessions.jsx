import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { cancelBooking, isFull, loadUpcoming, seatsText, sessionDay, sessionTime, setSessionVenue } from '../lib/booking.js'

// CRM тренера: ближайшие занятия, кто записался, перенос в другой зал
// (для субботы — «Олимпийский центр», лимит 50). Расписание и лимиты — в базе.
export default function AdminSessions() {
  const [sessions, setSessions] = useState([])
  const [people, setPeople] = useState({}) // session_id → [{ id, first_name, last_name }]
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setError('')
    try {
      const list = await loadUpcoming(7)
      setSessions(list)
      setOpen((o) => o ?? list[0]?.id ?? null)
      if (list.length) {
        const { data, error: e } = await supabase
          .from('bookings')
          .select(
            'session_id, created_at, athlete:profiles!bookings_athlete_id_fkey(id, first_name, last_name), inviter:profiles!bookings_invited_by_fkey(first_name, last_name)',
          )
          .in('session_id', list.map((s) => s.id))
          .order('created_at')
        if (e) throw e
        const map = {}
        data.forEach((b) => (map[b.session_id] ??= []).push({ ...b.athlete, inviter: b.inviter }))
        setPeople(map)
      }
    } catch (e) {
      setError('Не удалось загрузить записи: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const run = async (key, fn) => {
    setBusy(key)
    setError('')
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg">Запись на тренировки</h2>
      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>}
      {loading ? (
        <p className="card text-neutral-400">Загружаем занятия…</p>
      ) : sessions.length === 0 ? (
        <p className="card text-neutral-400">На ближайшую неделю занятий нет.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => {
            const expanded = open === s.id
            const list = people[s.id] ?? []
            const atAlt = s.alt_venue_id && s.venue_id === s.alt_venue_id
            return (
              <li key={s.id} className={`card !p-0 ${expanded ? 'border-accent/60' : ''}`}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : s.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 p-4 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-display uppercase tracking-wide">
                      {sessionDay(s.starts_at)} · {sessionTime(s)}
                    </p>
                    <p className="truncate text-sm text-neutral-400">
                      {s.title}
                      {s.venue_id !== 'club' && <span className="text-accent"> · {s.venue_name}</span>}
                    </p>
                    {/* Кто записался — видно сразу, без раскрытия */}
                    {!expanded && (
                      <p className={`mt-0.5 truncate text-xs ${list.length ? 'text-neutral-200' : 'text-neutral-600'}`}>
                        {list.length
                          ? list.map((p) => `${p.first_name} ${p.last_name?.[0] ?? ''}.`).join(', ')
                          : 'Никто не записался'}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 font-display text-lg tabular-nums ${isFull(s) ? 'text-accent' : ''}`}>
                    {seatsText(s)}
                  </span>
                </button>

                {/* Перенос в другой зал (суббота → Олимпийский центр) — виден сразу, без раскрытия */}
                {s.alt_venue_id && (
                  <label
                    className={`mx-4 mb-4 flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 ${
                      atAlt ? 'border-accent bg-accent/10' : 'border-line'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="font-semibold">📍 Олимпийский центр</span>
                      <span className="block text-xs text-neutral-400">
                        {atAlt
                          ? `${s.venue_address} · лимит ${s.capacity ?? '—'} мест`
                          : 'Выключено — тренировка в зале клуба'}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      className="h-6 w-6 shrink-0 accent-accent"
                      checked={Boolean(atAlt)}
                      disabled={busy === s.id}
                      onChange={(e) =>
                        run(s.id, () => setSessionVenue(s.id, e.target.checked ? s.alt_venue_id : 'club'))
                      }
                    />
                  </label>
                )}

                {expanded && (
                  <div className="space-y-3 border-t border-line p-4">
                    {list.length === 0 ? (
                      <p className="text-sm text-neutral-500">Пока никто не записался.</p>
                    ) : (
                      <ol className="space-y-1">
                        {list.map((p, i) => (
                          <li key={p.id} className="flex items-center gap-2 text-sm">
                            <span className="w-6 text-right text-neutral-500 tabular-nums">{i + 1}.</span>
                            <span className="flex-1 truncate">
                              {p.first_name} {p.last_name}
                              {p.inviter && (
                                <span className="ml-2 text-xs text-accent">гость · позвал {p.inviter.first_name} {p.inviter.last_name}</span>
                              )}
                            </span>
                            <button
                              type="button"
                              disabled={busy === `${s.id}:${p.id}`}
                              onClick={() => run(`${s.id}:${p.id}`, () => cancelBooking(s.id, p.id))}
                              className="text-xs text-neutral-500 hover:text-accent"
                            >
                              Убрать
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

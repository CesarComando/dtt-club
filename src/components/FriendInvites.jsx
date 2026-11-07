import { useCallback, useEffect, useState } from 'react'
import { sessionDay, sessionTime } from '../lib/booking.js'
import { answerFriendInvite, loadFriendInvites, setHideProfile } from '../lib/friends.js'
import { t, tData } from '../lib/i18n.jsx'

// Кабинет: «Артём Т. зовёт тебя на тренировку» → Записаться / Не смогу.
export default function FriendInvites({ onBooked }) {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    loadFriendInvites().then(setItems).catch(() => setItems([]))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const answer = async (inv, accept) => {
    setBusy(inv.id)
    setError('')
    try {
      await answerFriendInvite(inv.id, accept)
      setItems((list) => list.filter((x) => x.id !== inv.id))
      if (accept) onBooked?.()
    } catch (e) {
      setError(e.message)
      load()
    } finally {
      setBusy(null)
    }
  }

  if (!items.length) return null
  return (
    <section className="card space-y-3 border-accent/60">
      <p className="label">{t('Тебя зовут на тренировку')}</p>
      {items.map((inv) => {
        const full = inv.capacity != null && inv.booked >= inv.capacity
        return (
          <div key={inv.id} className="space-y-2 border-t border-line pt-3 first:border-0 first:pt-0">
            <p>
              <b>{inv.from_name}</b> {t('зовёт:')} {sessionDay(inv.starts_at)} · {sessionTime(inv)} · {tData(inv.title)}
              {inv.venue_name && <span className="text-neutral-400"> · {tData(inv.venue_name)}</span>}
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={busy === inv.id || full} onClick={() => answer(inv, true)} className="btn-primary disabled:opacity-60">
                {full ? t('Мест нет') : t('Записаться')}
              </button>
              <button type="button" disabled={busy === inv.id} onClick={() => answer(inv, false)} className="btn-outline disabled:opacity-60">
                {t('Не смогу')}
              </button>
            </div>
          </div>
        )
      })}
      {error && <p className="text-sm text-accent">{error}</p>}
    </section>
  )
}

/** Переключатель приватности: другие ученики видят только имя и фото. */
export function HideProfile({ profile, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (profile.role !== 'athlete') return null
  const on = Boolean(profile.hide_profile)

  const toggle = async () => {
    setBusy(true)
    setError('')
    try {
      await setHideProfile(profile.id, !on)
      await onChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className="card flex cursor-pointer items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block font-semibold">{t('Скрыть мой профиль')}</span>
        <span className="block text-xs text-neutral-400">
          {t('Другие ученики увидят только ваше имя и фото — без ранга, направления и числа тренировок. Ваш телефон и так видит только тренер.')}
        </span>
        {error && <span className="block text-xs text-accent">{error}</span>}
      </span>
      <input type="checkbox" className="h-6 w-6 shrink-0 accent-accent" checked={on} disabled={busy} onChange={toggle} />
    </label>
  )
}

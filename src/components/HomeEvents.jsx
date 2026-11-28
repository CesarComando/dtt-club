import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadUpcomingEvents } from '../lib/events.js'
import { useAuth } from '../lib/AuthContext.jsx'
import EventCard from './EventCard.jsx'
import { t } from '../lib/i18n.jsx'

// Главная: 3 ближайших события и ссылка на все. Пусто — блок не показываем (тренеру — ссылка «Добавить»).
export default function HomeEvents() {
  const { profile } = useAuth()
  const [list, setList] = useState(null)
  useEffect(() => {
    loadUpcomingEvents(3).then(setList).catch(() => setList([]))
  }, [])
  if (!list) return null
  if (!list.length) {
    return profile?.role === 'admin' ? (
      <Link to="/events" className="inline-block text-sm text-neutral-400 hover:text-white">{t('＋ Добавить событие (соревнования, опен мат)')}</Link>
    ) : null
  }
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-2xl">{t('Ближайшие события')}</h2>
        <Link to="/events" className="shrink-0 whitespace-nowrap text-sm text-accent hover:underline">{t('Все события')}</Link>
      </div>
      {list.map((ev) => (
        <Link key={ev.id} to="/events" className="block hover:opacity-90">
          <EventCard event={ev} />
        </Link>
      ))}
    </section>
  )
}

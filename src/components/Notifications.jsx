import { useEffect, useState } from 'react'
import { loadNotifications, markNotificationsRead } from '../lib/coach.js'

const ICON = { cancelled: '⛔', restored: '✅', moved: '🕒', venue: '📍' }

// Кабинет: непрочитанные уведомления (отмена / перенос / другой зал). «Понятно» — скрыть.
export default function Notifications() {
  const [items, setItems] = useState([])

  useEffect(() => {
    loadNotifications().then(setItems).catch(() => {}) // до слоя 34 таблицы нет — просто молчим
  }, [])

  if (!items.length) return null

  const dismiss = async (ids) => {
    setItems((list) => list.filter((n) => !ids.includes(n.id)))
    await markNotificationsRead(ids).catch(() => {})
  }

  return (
    <section className="space-y-2" aria-label="Уведомления">
      {items.map((n) => (
        <div key={n.id} className="flex items-start gap-3 rounded-md border border-accent/60 bg-accent/10 p-3 text-sm" role="status">
          <span aria-hidden="true">{ICON[n.kind] ?? '🔔'}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-white">{n.title}</p>
            <p className="text-neutral-300">{n.body}</p>
          </div>
          <button type="button" onClick={() => dismiss([n.id])} className="shrink-0 text-xs text-neutral-400 hover:text-white">
            Понятно
          </button>
        </div>
      ))}
      {items.length > 1 && (
        <button type="button" onClick={() => dismiss(items.map((n) => n.id))} className="text-xs text-neutral-500 hover:text-white">
          Скрыть все
        </button>
      )}
    </section>
  )
}

import { KINDS, KIND_ICON, eventWhen } from '../lib/events.js'
import { tData } from '../lib/i18n.jsx'

export default function EventCard({ event, children, full = false }) {
  return (
    <article className="flex gap-3 rounded-md border border-line p-3">
      <span className="text-2xl leading-none" aria-hidden="true">{KIND_ICON[event.kind] ?? '📅'}</span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs uppercase tracking-wide text-accent">{KINDS[event.kind]} · {eventWhen(event)}</p>
        <h3 className="break-words font-semibold text-white">{tData(event.title)}</h3>
        {event.place && <p className="break-words text-sm text-neutral-400">📍 {event.place}</p>}
        {full && event.description && <p className="whitespace-pre-line break-words pt-1 text-sm text-neutral-300">{event.description}</p>}
        {children}
      </div>
    </article>
  )
}

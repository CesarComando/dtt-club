import { useAuth } from '../lib/AuthContext.jsx'
import { useOffline } from '../lib/offline.js'
import { clearFailed, flush, useOutbox } from '../lib/outbox.js'
import { locale, t } from '../lib/i18n.jsx'

const time = (ms) =>
  new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// Плашка сверху: нет интернета / показаны сохранённые данные / ждут отправки действия тренера.
export default function OfflineBanner() {
  const { user } = useAuth()
  const { online, staleSince } = useOffline()
  const { items, failed, flushing } = useOutbox()
  const mine = items.filter((i) => !i.uid || i.uid === user?.id)
  if (online && !staleSince && !mine.length && !failed.length) return null

  return (
    <div className="mb-4 space-y-1 rounded-md border border-amber-500/60 bg-amber-500/10 p-3 text-sm" role="status">
      {!online ? (
        <p>
          <b>{t('Нет интернета.')}</b>{' '}
          {staleSince ? t('Показаны сохранённые данные от {date}.', { date: time(staleSince) }) : t('Показано то, что уже загружено.')}
        </p>
      ) : (
        staleSince && (
          <p>
            {t('Показаны сохранённые данные от {date} — не было связи с сервером.', { date: time(staleSince) })}{' '}
            <button type="button" onClick={() => window.location.reload()} className="font-semibold text-accent hover:underline">
              {t('Обновить данные')}
            </button>
          </p>
        )
      )}
      {mine.length > 0 && (
        <div>
          <p>
            <b>{t('Ждут отправки: {n}', { n: mine.length })}</b>{' '}
            {online ? (flushing ? t('— отправляем…') : '') : t('— уйдут сами, когда появится интернет.')}
          </p>
          <p className="truncate text-xs text-neutral-300">{mine.map((i) => i.label).join(' · ')}</p>
          {online && !flushing && (
            <button type="button" onClick={() => flush(user?.id)} className="mt-1 text-xs font-semibold text-accent hover:underline">
              {t('Отправить сейчас')}
            </button>
          )}
        </div>
      )}
      {failed.length > 0 && (
        <div className="text-accent">
          <p>
            <b>{t('Сервер не принял: {n}', { n: failed.length })}</b> — {failed.map((f) => `${f.label} (${f.error})`).join(' · ')}
          </p>
          <button type="button" onClick={clearFailed} className="text-xs underline">{t('Понятно, скрыть')}</button>
        </div>
      )}
    </div>
  )
}

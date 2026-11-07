import { useEffect, useState } from 'react'
import { TRIAL_DISCIPLINES, deleteTrial, loadTrials, prettyPhone, setTrialStatus, waLink } from '../lib/coach.js'
// tr, а не t: переменная t здесь — заявка.
import { t as tr, locale } from '../lib/i18n.jsx'

const STATUS = {
  new: [tr('Новая'), 'border-accent text-accent'],
  contacted: [tr('Связался'), 'border-amber-500 text-amber-400'],
  came: [tr('Пришёл'), 'border-emerald-600 text-emerald-400'],
  declined: [tr('Отказ'), 'border-line text-neutral-500'],
}

const when = (iso) =>
  new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Riga' })

const hello = (t) =>
  tr('Здравствуйте, {name}! Это Dainis, тренер Daugavpils Top Team. Вы оставили заявку на бесплатную пробную тренировку ({discipline}). Когда вам удобно прийти?', {
    name: t.name,
    discipline: TRIAL_DISCIPLINES[t.discipline],
  })

// Вкладка «Пробные»: заявки с сайта / страницы /trial. Новые — сверху.
export default function AdminTrials({ onCount }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)

  const load = () =>
    loadTrials()
      .then((r) => {
        setRows(r)
        onCount?.(r.filter((t) => t.status === 'new').length)
      })
      .catch((e) => setError(e.message.includes('trial_requests') ? tr('Выполните supabase/layer34_coach_tools.sql') : e.message))
  useEffect(() => {
    load()
  }, [])

  const run = async (id, fn) => {
    setBusy(id)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  if (error) return <p className="rounded-md border border-accent p-3 text-sm text-accent">{tr('Пробные: {error}', { error })}</p>
  if (!rows) return <p className="card text-neutral-400">{tr('Загружаем…')}</p>

  const link = `${window.location.href.split('#')[0]}#/trial`

  return (
    <section className="space-y-3">
      <div className="card space-y-1 text-sm">
        <p className="label">{tr('Ссылка на запись')}</p>
        <p className="break-all text-neutral-300">{link}</p>
        <p className="text-xs text-neutral-500">{tr('Кнопка на сайте клуба ведёт сюда. Можно ставить в Instagram, TikTok, WhatsApp.')}</p>
      </div>
      {rows.length === 0 ? (
        <p className="card text-neutral-400">{tr('Заявок пока нет.')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => {
            const [label, cls] = STATUS[t.status] ?? STATUS.new
            return (
              <li key={t.id} className={`card space-y-2 ${t.status === 'new' ? 'border-accent/60' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t.name}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}>{label}</span>
                  <span className="ml-auto text-xs text-neutral-500">{when(t.created_at)}</span>
                </div>
                <p className="text-sm text-neutral-300">
                  {TRIAL_DISCIPLINES[t.discipline]}
                  {t.age && ` · ${tr('{n} лет', { n: t.age })}`} ·{' '}
                  <a href={`tel:+${t.phone}`} className="hover:text-white">{prettyPhone(t.phone)}</a>
                </p>
                {t.preferred && <p className="text-sm text-neutral-400">{tr('Когда удобно: {when}', { when: t.preferred })}</p>}
                <div className="flex flex-wrap gap-2">
                  <a
                    href={waLink(t.phone, hello(t))}
                    target="_blank"
                    rel="noopener"
                    onClick={() => t.status === 'new' && run(t.id, () => setTrialStatus(t.id, 'contacted'))}
                    className="rounded border border-emerald-600 px-2 py-1 text-xs text-emerald-400 hover:border-emerald-400"
                  >
                    WhatsApp
                  </a>
                  {Object.entries(STATUS)
                    .filter(([k]) => k !== t.status && k !== 'new')
                    .map(([k, [l]]) => (
                      <button
                        key={k}
                        type="button"
                        disabled={busy === t.id}
                        onClick={() => run(t.id, () => setTrialStatus(t.id, k))}
                        className="rounded border border-line px-2 py-1 text-xs text-neutral-300 hover:border-accent disabled:opacity-50"
                      >
                        {l}
                      </button>
                    ))}
                  <button
                    type="button"
                    disabled={busy === t.id}
                    onClick={() => window.confirm(tr('Удалить заявку «{name}»?', { name: t.name })) && run(t.id, () => deleteTrial(t.id))}
                    className="ml-auto text-xs text-neutral-500 hover:text-accent disabled:opacity-50"
                  >
                    {tr('Удалить')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

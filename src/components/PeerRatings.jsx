import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CRITERIA, MIN_RATINGS, deleteRating, loadMyGiven, loadSummary, loadTeammates, saveRating } from '../lib/ratings.js'
import { t } from '../lib/i18n.jsx'

// Дневник → «Оценки»: мои средние от партнёров + оценить партнёра по всем критериям (CRITERIA).
// Оценивают только ученики друг друга (RLS в layer14) — тренеру показываем пояснение.
export default function PeerRatings({ userId, isAdmin }) {
  if (isAdmin) return <CoachNote userId={userId} />
  return <AthleteRatings userId={userId} />
}

function CoachNote({ userId }) {
  const [mates, setMates] = useState(null)
  useEffect(() => {
    loadTeammates(userId).then(setMates).catch(() => setMates([]))
  }, [userId])
  return (
    <section className="card space-y-3">
      <h2 className="text-xl">{t('Оценки ставят ученики')}</h2>
      <p className="text-sm text-neutral-400">
        {t('Тренер оценки не ставит — так средние честно показывают мнение партнёров. Средние баллы и кто кого оценил видны в карточке ученика:')}
      </p>
      <ul className="divide-y divide-line">
        {(mates ?? []).map((m) => (
          <li key={m.id} className="py-2">
            <Link to={`/admin/athlete/${m.id}`} className="hover:text-accent hover:underline">
              {m.first_name} {m.last_name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Ошибки базы — понятным языком.
const friendly = (e) =>
  /row-level security/i.test(e?.message ?? '')
    ? t('Эту оценку поставить нельзя: оценивают только ученики друг друга (не себя и не тренера).')
    : e.message

function AthleteRatings({ userId }) {
  const [summary, setSummary] = useState(null)
  const [mates, setMates] = useState(null)
  const [given, setGiven] = useState({})
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([loadSummary(), loadTeammates(userId), loadMyGiven(userId)])
      .then(([s, m, g]) => {
        setSummary(s)
        setMates(m)
        setGiven(g)
      })
      .catch((e) => {
        setError(e.message)
        setMates([])
      })
  }, [userId])

  const q = query.trim().toLowerCase()
  const list = useMemo(
    () => (mates ?? []).filter((m) => !q || `${m.first_name} ${m.last_name}`.toLowerCase().includes(q)),
    [mates, q],
  )

  return (
    <div className="space-y-4">
      <MySummary summary={summary} />

      <section className="card space-y-3">
        <div>
          <h2 className="text-xl">{t('Оценить партнёра')}</h2>
          <p className="text-xs text-neutral-500">
            {t('Оценка 1–5. Ваше имя партнёр не увидит — только средний балл, когда оценок наберётся {n}+.', { n: MIN_RATINGS })}
          </p>
        </div>
        {error && <p className="text-sm text-accent">{error}</p>}
        <input value={query} onChange={(e) => setQuery(e.target.value)} className="input" placeholder={t('Найти по имени…')} aria-label={t('Поиск партнёра')} />
        {mates == null ? (
          <p className="text-sm text-neutral-400">{t('Загружаем…')}</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('Никого не нашли.')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((m) => (
              <li key={m.id} className="py-2">
                <button
                  type="button"
                  onClick={() => setOpen(open === m.id ? null : m.id)}
                  aria-expanded={open === m.id}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span className="truncate">{m.first_name} {m.last_name}</span>
                  <span className={`shrink-0 text-xs ${given[m.id] ? 'text-accent' : 'text-neutral-500'}`}>
                    {given[m.id] ? `✓ ${t('оценён')}` : t('Оценить')}
                  </span>
                </button>
                {open === m.id && (
                  <RateForm
                    key={m.id}
                    initial={given[m.id]}
                    onSave={async (scores) => {
                      await saveRating(userId, m.id, scores)
                      setGiven((g) => ({ ...g, [m.id]: scores }))
                      setOpen(null)
                    }}
                    onDelete={async () => {
                      await deleteRating(userId, m.id)
                      setGiven((g) => {
                        const copy = { ...g }
                        delete copy[m.id]
                        return copy
                      })
                      setOpen(null)
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function MySummary({ summary }) {
  if (!summary) return null
  const enough = summary.ratings >= MIN_RATINGS && summary.technique != null
  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl">{t('Мои оценки от партнёров')}</h2>
        <span className="text-xs text-neutral-500">{t('{n} оц.', { n: summary.ratings })}</span>
      </div>
      {!enough ? (
        <p className="text-sm text-neutral-400">
          {t('Средние появятся, когда вас оценят хотя бы {n} партнёра', { n: MIN_RATINGS })}
          {summary.ratings > 0 && ` ${t('(сейчас {n})', { n: summary.ratings })}`}.
        </p>
      ) : (
        <ul className="space-y-2">
          {CRITERIA.map((c) => {
            const v = summary[c.key] == null ? null : Number(summary[c.key])
            return (
              <li key={c.key} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-neutral-300">{c.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink">
                  <div className="h-full bg-accent" style={{ width: `${((v ?? 0) / 5) * 100}%` }} />
                </div>
                <span className="w-8 text-right font-display tabular-nums">{v == null ? '—' : v.toFixed(1)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function RateForm({ initial, onSave, onDelete }) {
  const [scores, setScores] = useState(initial ?? {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const complete = CRITERIA.every((c) => scores[c.key])

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(friendly(e))
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-line p-3">
      {CRITERIA.map((c) => (
        <div key={c.key} className="flex items-center justify-between gap-2">
          <span className="text-sm text-neutral-300">{c.label}</span>
          <div className="flex gap-1" role="radiogroup" aria-label={c.label}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={scores[c.key] === n}
                onClick={() => setScores((s) => ({ ...s, [c.key]: n }))}
                className={`h-8 w-8 rounded-md border text-sm font-semibold ${
                  scores[c.key] >= n ? 'border-accent bg-accent text-white' : 'border-line text-neutral-500'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ))}
      {error && <p className="text-sm text-accent">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" disabled={!complete || busy} onClick={() => run(() => onSave(scores))} className="btn-primary disabled:opacity-50">
          {busy ? '…' : initial ? t('Обновить') : t('Сохранить')}
        </button>
        {initial && (
          <button type="button" disabled={busy} onClick={() => run(onDelete)} className="text-xs text-neutral-500 hover:text-accent">
            {t('Удалить оценку')}
          </button>
        )}
        {!complete && <span className="text-xs text-neutral-500">{t('Оцените все {n} пунктов', { n: CRITERIA.length })}</span>}
      </div>
    </div>
  )
}

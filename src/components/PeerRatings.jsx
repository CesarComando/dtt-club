import { useEffect, useMemo, useState } from 'react'
import { CRITERIA, MIN_RATINGS, deleteRating, loadMyGiven, loadSummary, loadTeammates, saveRating } from '../lib/ratings.js'

// Дневник → «Оценки»: мои средние от партнёров + оценить партнёра по 7 критериям.
export default function PeerRatings({ userId }) {
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
          <h2 className="text-xl">Оценить партнёра</h2>
          <p className="text-xs text-neutral-500">
            Оценка 1–5. Ваше имя партнёр не увидит — только средний балл, когда оценок наберётся {MIN_RATINGS}+.
          </p>
        </div>
        {error && <p className="text-sm text-accent">{error}</p>}
        <input value={query} onChange={(e) => setQuery(e.target.value)} className="input" placeholder="Найти по имени…" aria-label="Поиск партнёра" />
        {mates == null ? (
          <p className="text-sm text-neutral-400">Загружаем…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-neutral-400">Никого не нашли.</p>
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
                    {given[m.id] ? '✓ оценён' : 'Оценить'}
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
        <h2 className="text-xl">Мои оценки от партнёров</h2>
        <span className="text-xs text-neutral-500">{summary.ratings} оц.</span>
      </div>
      {!enough ? (
        <p className="text-sm text-neutral-400">
          Средние появятся, когда вас оценят хотя бы {MIN_RATINGS} партнёра
          {summary.ratings > 0 && ` (сейчас ${summary.ratings})`}.
        </p>
      ) : (
        <ul className="space-y-2">
          {CRITERIA.map((c) => {
            const v = Number(summary[c.key])
            return (
              <li key={c.key} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-neutral-300">{c.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink">
                  <div className="h-full bg-accent" style={{ width: `${(v / 5) * 100}%` }} />
                </div>
                <span className="w-8 text-right font-display tabular-nums">{v.toFixed(1)}</span>
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
      setError(e.message)
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
          {busy ? '…' : initial ? 'Обновить' : 'Сохранить'}
        </button>
        {initial && (
          <button type="button" disabled={busy} onClick={() => run(onDelete)} className="text-xs text-neutral-500 hover:text-accent">
            Удалить оценку
          </button>
        )}
        {!complete && <span className="text-xs text-neutral-500">Оцените все 7 пунктов</span>}
      </div>
    </div>
  )
}

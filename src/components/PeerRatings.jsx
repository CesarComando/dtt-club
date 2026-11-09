import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CRITERIA, MAX_SCORE, MIN_RATINGS, deleteRating, fmtScore, loadLeaderboard, loadMyGiven, loadSummary, loadTeammates, saveRating } from '../lib/ratings.js'
import { DISCIPLINES } from '../lib/ranks.js'
import { t } from '../lib/i18n.jsx'

// Дневник → «Оценки»: мои средние от партнёров + оценить партнёра по всем критериям (CRITERIA).
// Оценивают только ученики друг друга (RLS в layer14) — тренеру показываем пояснение.
export default function PeerRatings({ userId, isAdmin, discipline }) {
  return (
    <div className="space-y-4">
      <Leaderboard myId={userId} initial={discipline === 'mma' ? 'mma' : 'grappling'} />
      {isAdmin ? <CoachNote userId={userId} /> : <AthleteRatings userId={userId} />}
    </div>
  )
}

// Рейтинг клуба (слой 39): отдельно MMA и грэпплинг, средний балл 7 критериев (без гигиены).
const MEDALS = ['🥇', '🥈', '🥉']
function Leaderboard({ myId, initial }) {
  const [tab, setTab] = useState(initial)
  const [data, setData] = useState({}) // discipline → rows | { error }

  useEffect(() => {
    if (data[tab]) return
    loadLeaderboard(tab)
      .then((rows) => setData((d) => ({ ...d, [tab]: rows })))
      .catch((e) => setData((d) => ({ ...d, [tab]: { error: e.message } })))
  }, [tab, data])

  const rows = data[tab]
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl">{t('Рейтинг клуба')}</h2>
        <div className="flex gap-1" role="tablist">
          {['mma', 'grappling'].map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={tab === d}
              onClick={() => setTab(d)}
              className={`rounded-full border px-3 py-1 text-xs ${tab === d ? 'border-accent bg-accent/15 text-white' : 'border-line text-neutral-400'}`}
            >
              {DISCIPLINES[d]}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-neutral-500">
        {t('Средний балл от партнёров по 7 критериям (гигиена не считается), максимум 10. В рейтинге — у кого {n}+ оценок.', { n: MIN_RATINGS })}
      </p>
      {!rows ? (
        <p className="text-sm text-neutral-400">{t('Загружаем…')}</p>
      ) : rows.error ? (
        <p className="text-sm text-accent">{/peer_leaderboard/.test(rows.error) ? t('Рейтинг ещё не включён в базе.') : rows.error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-400">{t('Пока никого: нужно {n}+ оценок от партнёров.', { n: MIN_RATINGS })}</p>
      ) : (
        <ol className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.id} className={`flex items-center gap-3 py-2 ${r.id === myId ? 'text-accent' : ''}`}>
              <span className="w-7 shrink-0 text-center font-display tabular-nums">{MEDALS[i] ?? i + 1}</span>
              <span className={`min-w-0 flex-1 truncate ${r.id === myId ? 'font-semibold' : ''}`}>
                {r.first_name} {r.last_name}
              </span>
              <span className="shrink-0 text-xs text-neutral-500">{t('{n} оц.', { n: r.ratings })}</span>
              <span className="w-12 shrink-0 text-right font-display text-lg tabular-nums">{fmtScore(r.score)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
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
            {t('Оценка 1–10: нажмите цифру, потом уточните (9,5 или 9,76). Ваше имя партнёр не увидит — только средний балл, когда оценок наберётся {n}+.', { n: MIN_RATINGS })}
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
                  <div className="h-full bg-accent" style={{ width: `${((v ?? 0) / MAX_SCORE) * 100}%` }} />
                </div>
                <span className="w-10 text-right font-display tabular-nums">{fmtScore(v)}</span>
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
        <ScoreInput key={c.key} label={c.label} value={scores[c.key]} onChange={(v) => setScores((s) => ({ ...s, [c.key]: v }))} />
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

// Оценка 1–10 с сотыми: нажал «9» → ниже 9 · 9,25 · 9,5 · 9,75 или вписать своё (9,76).
function ScoreInput({ label, value, onChange }) {
  const [refine, setRefine] = useState(false)
  const [own, setOwn] = useState('')
  const base = value ? Math.floor(value) : null

  const pick = (n) => {
    onChange(n)
    setOwn('')
    setRefine(n < MAX_SCORE)
  }
  const typed = (text) => {
    setOwn(text)
    const v = Number(text.replace(',', '.'))
    if (Number.isFinite(v) && v >= 1 && v <= MAX_SCORE) onChange(Math.round(v * 100) / 100)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-neutral-300">{label}</span>
        <span className="font-display text-lg tabular-nums">{fmtScore(value)}</span>
      </div>
      <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label={label}>
        {Array.from({ length: MAX_SCORE }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={base === n}
            onClick={() => pick(n)}
            className={`h-8 rounded-md border text-sm font-semibold ${
              base === n ? 'border-accent bg-accent text-white' : base > n ? 'border-accent/40 bg-accent/20 text-white' : 'border-line text-neutral-500'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      {refine && base != null && base < MAX_SCORE && (
        <div className="flex flex-wrap items-center gap-1.5">
          {[0, 0.25, 0.5, 0.75].map((d) => {
            const v = base + d
            return (
              <button
                key={d}
                type="button"
                onClick={() => {
                  onChange(v)
                  setOwn('')
                }}
                className={`rounded border px-2 py-1 text-sm tabular-nums ${value === v ? 'border-accent bg-accent/15 text-white' : 'border-line text-neutral-300'}`}
              >
                {fmtScore(v)}
              </button>
            )
          })}
          <input
            className="input !w-20 !py-1 text-sm"
            inputMode="decimal"
            placeholder={fmtScore(base + 0.76)}
            value={own}
            onChange={(e) => typed(e.target.value)}
            aria-label={t('Своя оценка')}
          />
          <button type="button" onClick={() => setRefine(false)} className="text-xs text-neutral-500 hover:text-white">
            {t('Готово')}
          </button>
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import {
  addDiaryEntry,
  deleteDiaryEntry,
  fitsDiscipline,
  loadDiary,
  loadLearned,
  loadTechniques,
  setLearned,
} from '../lib/diary.js'
import PeerRatings from '../components/PeerRatings.jsx'
import { locale, t, tData } from '../lib/i18n.jsx'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Riga' })
const dayLabel = (iso) => {
  const s = new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const STATUS = {
  learning: { label: t('Изучаю'), cls: 'border-white/60 text-white' },
  mastered: { label: t('Освоил'), cls: 'border-accent bg-accent/15 text-white' },
}
// Нажатие по приёму: нет → изучаю → освоил → нет.
const nextStatus = (s) => (s == null ? 'learning' : s === 'learning' ? 'mastered' : null)

// Дневник тренировок: запись после занятия (заметки + какие приёмы применял)
// и «Мои приёмы» — что изучаю и что уже освоил.
export default function Diary() {
  const { user, profile, loading } = useAuth()
  const [tab, setTab] = useState('diary')
  const [techniques, setTechniques] = useState([])
  const [learned, setLearnedMap] = useState({})
  const [error, setError] = useState('')
  const headCoach = profile?.role === 'admin'

  useEffect(() => {
    if (!user) return
    Promise.all([loadTechniques(), loadLearned(user.id)])
      .then(([t, l]) => {
        setTechniques(t)
        setLearnedMap(l)
      })
      .catch((e) => setError(e.message))
  }, [user])

  const mine = useMemo(
    () => techniques.filter((t) => fitsDiscipline(t, profile?.discipline)),
    [techniques, profile?.discipline],
  )

  if (loading) return null
  if (!user) {
    return (
      <div className="mx-auto max-w-sm py-16 text-center">
        <h1 className="text-3xl">{t('Дневник тренировок')}</h1>
        <p className="mt-3 text-neutral-400">{t('Войдите, чтобы вести дневник и отмечать освоенные приёмы.')}</p>
        <Link to="/login?next=%2Fdiary" className="btn-primary mt-6 inline-block">{t('Войти')}</Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <h1 className="text-3xl">{t('Дневник')}</h1>
      <div className={`grid gap-2 ${headCoach ? 'grid-cols-2' : 'grid-cols-3'}`} role="tablist">
        {[
          ['diary', t('Записи')],
          ['techniques', t('Мои приёмы')],
          // У главного тренера оценки — в «Тренерская → Статистика»
          ...(headCoach ? [] : [['ratings', t('Оценки')]]),
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-md border py-2.5 font-display text-sm uppercase tracking-wider ${
              tab === id ? 'border-accent bg-accent/10 text-white' : 'border-line text-neutral-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>}
      {tab === 'diary' ? (
        <DiaryEntries userId={user.id} techniques={mine} />
      ) : tab === 'ratings' ? (
        <PeerRatings userId={user.id} isAdmin={profile?.role !== 'athlete'} discipline={profile?.discipline} />
      ) : (
        <MyTechniques userId={user.id} techniques={mine} learned={learned} setLearnedMap={setLearnedMap} onError={setError} />
      )}
    </div>
  )
}

function DiaryEntries({ userId, techniques }) {
  const [entries, setEntries] = useState(null)
  const [date, setDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [picked, setPicked] = useState([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadDiary(userId)
      .then(setEntries)
      .catch((e) => {
        setError(e.message)
        setEntries([])
      })
  }, [userId])

  const q = query.trim().toLowerCase()
  const options = techniques
    .filter((x) => !picked.includes(x.name) && (!q || x.name.toLowerCase().includes(q) || tData(x.name).toLowerCase().includes(q)))
    .slice(0, 12)
  const toggle = (name) => setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]))

  const save = async (e) => {
    e.preventDefault()
    if (!notes.trim() && !picked.length) return setError(t('Напишите пару слов или отметьте приёмы.'))
    setBusy(true)
    setError('')
    try {
      const row = await addDiaryEntry({ date, notes: notes.trim(), applied_techniques: picked })
      setEntries((list) => [row, ...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)))
      setNotes('')
      setPicked([])
      setQuery('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    if (!window.confirm(t('Удалить запись?'))) return
    try {
      await deleteDiaryEntry(id)
      setEntries((list) => list.filter((x) => x.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={save} className="card space-y-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl">{t('Новая запись')}</h2>
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="input !w-auto !px-2" aria-label={t('Дата')} />
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={4000}
          rows={4}
          className="input"
          placeholder={t('Что отрабатывали, что получилось, над чем работать…')}
          aria-label={t('Заметки')}
        />
        <div className="space-y-2">
          <p className="label">{t('Применял приёмы')}</p>
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {picked.map((n) => (
                <button key={n} type="button" onClick={() => toggle(n)} className="rounded-full border border-accent bg-accent/15 px-3 py-1 text-xs">
                  {tData(n)} ✕
                </button>
              ))}
            </div>
          )}
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="input" placeholder={t('Найти приём…')} aria-label={t('Поиск приёма')} />
          <div className="flex flex-wrap gap-1.5">
            {options.map((x) => (
              <button key={x.id} type="button" onClick={() => toggle(x.name)} className="rounded-full border border-line px-3 py-1 text-xs text-neutral-300 hover:border-white/40">
                + {tData(x.name)}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-accent">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">
          {busy ? t('Сохраняем…') : t('Сохранить запись')}
        </button>
      </form>

      <section className="space-y-2">
        <h2 className="text-lg">{t('Мои записи')}</h2>
        {entries == null ? (
          <p className="card text-neutral-400">{t('Загружаем…')}</p>
        ) : entries.length === 0 ? (
          <p className="card text-neutral-400">{t('Пока пусто. Запишите первую тренировку!')}</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="card space-y-2 !p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-display uppercase tracking-wide">{dayLabel(e.date)}</p>
                  <button type="button" onClick={() => remove(e.id)} className="text-xs text-neutral-500 hover:text-accent">{t('Удалить')}</button>
                </div>
                {e.notes && <p className="whitespace-pre-line text-sm text-neutral-300">{e.notes}</p>}
                {e.applied_techniques.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {e.applied_techniques.map((n) => (
                      <span key={n} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-neutral-400">{tData(n)}</span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function MyTechniques({ userId, techniques, learned, setLearnedMap, onError }) {
  const [busy, setBusy] = useState(null)
  const groups = useMemo(() => {
    const m = new Map()
    techniques.forEach((t) => m.set(t.category, [...(m.get(t.category) ?? []), t]))
    return [...m.entries()]
  }, [techniques])
  const mastered = Object.values(learned).filter((s) => s === 'mastered').length
  const learning = Object.values(learned).filter((s) => s === 'learning').length

  const cycle = async (t) => {
    const status = nextStatus(learned[t.id])
    setBusy(t.id)
    try {
      await setLearned(userId, t.id, status)
      setLearnedMap((m) => {
        const copy = { ...m }
        if (status) copy[t.id] = status
        else delete copy[t.id]
        return copy
      })
    } catch (e) {
      onError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3">
        <div className="card !p-4 text-center">
          <p className="font-display text-3xl text-accent">{mastered}</p>
          <p className="text-[11px] uppercase tracking-wider text-neutral-400">{t('Освоил')}</p>
        </div>
        <div className="card !p-4 text-center">
          <p className="font-display text-3xl">{learning}</p>
          <p className="text-[11px] uppercase tracking-wider text-neutral-400">{t('Изучаю')}</p>
        </div>
      </section>
      <p className="text-xs text-neutral-500">{t('Нажмите на приём: «изучаю» → «освоил» → убрать.')}</p>
      {groups.map(([category, list]) => (
        <section key={category} className="card space-y-2 !p-4">
          <h2 className="font-display text-sm uppercase tracking-wider text-neutral-400">{tData(category)}</h2>
          <div className="flex flex-wrap gap-1.5">
            {list.map((x) => {
              const s = learned[x.id]
              return (
                <button
                  key={x.id}
                  type="button"
                  disabled={busy === x.id}
                  onClick={() => cycle(x)}
                  className={`rounded-full border px-3 py-1 text-xs disabled:opacity-50 ${s ? STATUS[s].cls : 'border-line text-neutral-400'}`}
                >
                  {s === 'mastered' ? '✓ ' : s === 'learning' ? '◐ ' : ''}
                  {tData(x.name)}
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

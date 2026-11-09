import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import {
  LEVEL,
  LEVELS,
  addDiaryEntry,
  confirmTechnique,
  deleteDiaryEntry,
  fitsDiscipline,
  loadDiary,
  loadFocus,
  loadFocusProgress,
  loadLearned,
  loadPendingConfirmations,
  loadTechniques,
  nextLevel,
  saveFocus,
  setLearned,
} from '../lib/diary.js'
import PeerRatings from '../components/PeerRatings.jsx'
import { locale, t, tData } from '../lib/i18n.jsx'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Riga' })
const dayLabel = (iso) => {
  const s = new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}


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
        <MyTechniques
          userId={user.id}
          techniques={mine}
          allTechniques={techniques}
          discipline={profile?.discipline}
          headCoach={headCoach}
          learned={learned}
          setLearnedMap={setLearnedMap}
          onError={setError}
        />
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

function MyTechniques({ userId, techniques, allTechniques, discipline, headCoach, learned, setLearnedMap, onError }) {
  const [busy, setBusy] = useState(null)
  const groups = useMemo(() => {
    const m = new Map()
    techniques.forEach((t) => m.set(t.category, [...(m.get(t.category) ?? []), t]))
    return [...m.entries()]
  }, [techniques])
  const count = (lvl) => Object.values(learned).filter((x) => x.status === lvl).length

  const cycle = async (x) => {
    const status = nextLevel(learned[x.id]?.status)
    setBusy(x.id)
    try {
      await setLearned(userId, x.id, status)
      setLearnedMap((m) => {
        const copy = { ...m }
        // «В спарринге» у ученика ждёт подтверждения тренера; свои приёмы главного тренера — сразу.
        if (status) copy[x.id] = { status, confirmed: status === 'mastered' && headCoach }
        else delete copy[x.id]
        return copy
      })
    } catch (e) {
      onError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const Chip = ({ x }) => {
    const l = learned[x.id]
    const pending = l?.status === 'mastered' && !l.confirmed
    return (
      <button
        type="button"
        disabled={busy === x.id}
        onClick={() => cycle(x)}
        className={`rounded-full border px-3 py-1.5 text-xs disabled:opacity-50 ${l ? LEVEL[l.status].cls : 'border-line text-neutral-400'}`}
        title={l ? (pending ? t('В спарринге — ждёт подтверждения тренера') : LEVEL[l.status].label) : t('Не отмечено')}
      >
        {l ? `${pending ? '⏳' : LEVEL[l.status].icon} ` : ''}
        {tData(x.name)}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {headCoach && <CoachConfirmations />}
      <FocusCard discipline={discipline} headCoach={headCoach} allTechniques={allTechniques} learned={learned} Chip={Chip} />
      <section className="grid grid-cols-3 gap-2">
        {LEVELS.map((lvl) => (
          <div key={lvl} className="card !p-3 text-center">
            <p className={`font-display text-2xl ${lvl === 'mastered' ? 'text-accent' : lvl === 'drill' ? 'text-amber-300' : ''}`}>{count(lvl)}</p>
            <p className="text-[10px] uppercase tracking-wider text-neutral-400">{LEVEL[lvl].label}</p>
          </div>
        ))}
      </section>
      <p className="text-xs text-neutral-500">
        {t('Нажимайте на приём: ◔ изучаю → ◑ на дрилле → ✓ в спарринге → убрать. «В спарринге» подтверждает тренер, до этого — ⏳.')}
      </p>
      {groups.map(([category, list]) => (
        <section key={category} className="card space-y-2 !p-4">
          <h2 className="font-display text-sm uppercase tracking-wider text-neutral-400">{tData(category)}</h2>
          <div className="flex flex-wrap gap-1.5">
            {list.map((x) => (
              <Chip key={x.id} x={x} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

const monthRange = (a, b) => {
  const f = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { month: 'long' })
  return `${f(a)} — ${f(b)}`
}

// Тема периода: приёмы темы с моими уровнями и прогрессом группы (только числа).
function FocusCard({ discipline, headCoach, allTechniques, learned, Chip }) {
  const [focus, setFocus] = useState(undefined)
  const [progress, setProgress] = useState({})
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    loadFocus(headCoach ? null : discipline)
      .then((f) => {
        setFocus(f)
        if (f) loadFocusProgress(f.id).then((rows) => setProgress(Object.fromEntries(rows.map((r) => [r.technique_id, r])))).catch(() => {})
      })
      .catch(() => setFocus(null))
  }, [discipline, headCoach])

  if (!focus) return null
  const list = focus.technique_ids.map((id) => allTechniques.find((x) => x.id === id)).filter(Boolean)
  const done = list.filter((x) => learned[x.id]?.status === 'mastered' && learned[x.id]?.confirmed).length

  return (
    <section className="card space-y-3 border-accent/60">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">{t('Тема · {range}', { range: monthRange(focus.starts_on, focus.ends_on) })}</p>
          <h2 className="text-2xl">{tData(focus.title)}</h2>
        </div>
        <span className="font-display text-2xl tabular-nums text-accent">
          {done}/{list.length}
        </span>
      </div>
      {focus.note && <p className="text-sm text-neutral-300">{focus.note}</p>}
      <ul className="space-y-2">
        {list.map((x) => {
          const p = progress[x.id]
          return (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
              <Chip x={x} />
              {p && (
                <span className="text-xs tabular-nums text-neutral-500" title={t('Сколько в клубе: изучают · на дрилле · в спарринге')}>
                  {LEVEL.learning.icon} {p.learning} · {LEVEL.drill.icon} {p.drill} · {LEVEL.mastered.icon} {p.sparring}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-neutral-500">{t('Справа — сколько человек в клубе на каждом уровне.')}</p>
      {headCoach &&
        (editing ? (
          <FocusEditor focus={focus} allTechniques={allTechniques} onSaved={(f) => { setFocus(f); setEditing(false) }} onCancel={() => setEditing(false)} />
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="text-sm text-neutral-400 underline-offset-4 hover:text-white hover:underline">
            {t('Изменить тему')}
          </button>
        ))}
    </section>
  )
}

function FocusEditor({ focus, allTechniques, onSaved, onCancel }) {
  const [form, setForm] = useState({
    title: focus.title,
    starts_on: focus.starts_on,
    ends_on: focus.ends_on,
    note: focus.note ?? '',
    technique_ids: focus.technique_ids,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = (id) =>
    setForm((f) => ({ ...f, technique_ids: f.technique_ids.includes(id) ? f.technique_ids.filter((x) => x !== id) : [...f.technique_ids, id] }))
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSaved(await saveFocus(focus.id, { ...form, note: form.note.trim() || null }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={save} className="space-y-3 rounded-md border border-line p-3">
      <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required aria-label={t('Название темы')} />
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className="input" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} required aria-label={t('С')} />
        <input type="date" className="input" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} required aria-label={t('По')} />
      </div>
      <textarea className="input" rows={2} placeholder={t('Заметка для учеников (необязательно)')} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
        {allTechniques.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => toggle(x.id)}
            className={`rounded-full border px-2.5 py-1 text-xs ${form.technique_ids.includes(x.id) ? 'border-accent bg-accent/15 text-white' : 'border-line text-neutral-500'}`}
          >
            {tData(x.name)}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-accent">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary flex-1 disabled:opacity-60">{t('Сохранить')}</button>
        <button type="button" onClick={onCancel} className="btn-outline flex-1">{t('Отмена')}</button>
      </div>
    </form>
  )
}

// Главный тренер: кто отметил «в спарринге» — подтвердить или вернуть на дрилл.
function CoachConfirmations() {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    loadPendingConfirmations().then(setRows).catch((e) => setError(e.message))
  }, [])
  const people = useMemo(() => {
    const m = new Map()
    ;(rows ?? []).forEach((r) => m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]))
    return [...m.values()]
  }, [rows])

  const act = async (list, ok) => {
    setBusy(list.map((r) => `${r.user_id}-${r.technique_id}`).join(','))
    setError('')
    try {
      for (const r of list) await confirmTechnique(r.user_id, r.technique_id, ok)
      const done = new Set(list.map((r) => `${r.user_id}-${r.technique_id}`))
      setRows((all) => all.filter((r) => !done.has(`${r.user_id}-${r.technique_id}`)))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  if (error) return <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>
  if (!rows?.length) return null
  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xl">{t('Ждут подтверждения')}</h2>
        <span className="font-display text-2xl text-accent">{rows.length}</span>
      </div>
      <p className="text-xs text-neutral-500">{t('Ученик отметил «получается в спарринге». ✓ — подтвердить, ✗ — вернуть на «дрилл».')}</p>
      {people.map((list) => (
        <div key={list[0].user_id} className="space-y-1.5 border-t border-line pt-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{list[0].first_name} {list[0].last_name}</p>
            {list.length > 1 && (
              <button type="button" disabled={Boolean(busy)} onClick={() => act(list, true)} className="text-xs text-emerald-400 hover:underline disabled:opacity-50">
                {t('Подтвердить все ({n})', { n: list.length })}
              </button>
            )}
          </div>
          {list.map((r) => (
            <div key={r.technique_id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{tData(r.technique)}</span>
              <span className="flex shrink-0 gap-1">
                <button type="button" disabled={Boolean(busy)} onClick={() => act([r], true)} aria-label={t('Подтвердить')} className="h-9 w-9 rounded-md border border-emerald-600 text-emerald-400 disabled:opacity-50">✓</button>
                <button type="button" disabled={Boolean(busy)} onClick={() => act([r], false)} aria-label={t('Вернуть на дрилл')} className="h-9 w-9 rounded-md border border-line text-neutral-400 disabled:opacity-50">✗</button>
              </span>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}

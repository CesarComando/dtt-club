import { useEffect, useState } from 'react'
import {
  COMP_DISCIPLINES,
  MEDAL,
  METHODS,
  RESULTS,
  competitionStats,
  deleteCompetition,
  emptyFight,
  loadCompetitions,
  saveCompetition,
} from '../lib/competitions.js'
import { t, locale } from '../lib/i18n.jsx'

// «Мои награды и соревнования»: ученик сам записывает турниры, место и бои с разбором
// («как выиграл» / «чего не хватило»). readOnly — карточка ученика у тренера.
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Riga' })
const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })
const blank = (discipline) => ({
  date: today(),
  title: '',
  city: '',
  discipline: ['mma', 'k1'].includes(discipline) ? discipline : 'grappling',
  category: '',
  place: '',
  notes: '',
  fights: [],
})

export default function Competitions({ userId, discipline, readOnly = false, onStats }) {
  const [list, setList] = useState(null)
  const [editing, setEditing] = useState(null) // null | объект формы
  const [error, setError] = useState('')

  useEffect(() => {
    loadCompetitions(userId)
      .then(setList)
      .catch((e) => {
        setError(/competitions/.test(e.message) ? t('Раздел соревнований ещё не включён в базе.') : e.message)
        setList([])
      })
  }, [userId])

  useEffect(() => {
    if (list) onStats?.(competitionStats(list))
  }, [list, onStats])

  const saved = (row) => {
    setList((l) => [row, ...(l ?? []).filter((x) => x.id !== row.id)].sort((a, b) => (a.date < b.date ? 1 : -1)))
    setEditing(null)
  }
  const remove = async (c) => {
    if (!window.confirm(t('Удалить «{title}»?', { title: c.title }))) return
    try {
      await deleteCompetition(c.id)
      setList((l) => l.filter((x) => x.id !== c.id))
    } catch (e) {
      setError(e.message)
    }
  }

  const s = competitionStats(list ?? [])
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg">{readOnly ? t('Соревнования') : t('Мои награды и соревнования')}</h2>
        {!readOnly && !editing && (
          <button type="button" onClick={() => setEditing(blank(discipline))} className="btn-outline !px-3 !py-1.5 text-sm">
            {t('+ Добавить')}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-accent">{error}</p>}
      {editing && <CompetitionForm userId={userId} value={editing} onSaved={saved} onCancel={() => setEditing(null)} />}

      {list && list.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <Tile value={s.medals} label={t('Медалей')} />
          <Tile value={s.wins} label={t('Побед')} cls="text-emerald-400" />
          <Tile value={s.losses} label={t('Поражений')} />
        </div>
      )}

      {list === null ? (
        <p className="card text-neutral-400">{t('Загружаем…')}</p>
      ) : list.length === 0 ? (
        !editing && (
          <div className="card space-y-1 text-neutral-400">
            <p>{readOnly ? t('Пока не записал ни одного турнира.') : t('Пока нет наград — всё впереди!')}</p>
            {!readOnly && <p className="text-xs">{t('Выступил на турнире? Запишите место и бои — что сработало и чего не хватило. Так видно, над чем работать.')}</p>}
          </div>
        )
      ) : (
        list.map((c) => (
          <CompetitionCard key={c.id} c={c} readOnly={readOnly} onEdit={() => setEditing({ ...c, place: c.place ?? '', city: c.city ?? '', category: c.category ?? '', notes: c.notes ?? '' })} onDelete={() => remove(c)} />
        ))
      )}
    </section>
  )
}

const Tile = ({ value, label, cls = '' }) => (
  <div className="card !p-3 text-center">
    <p className={`font-display text-2xl ${cls}`}>{value}</p>
    <p className="text-[10px] uppercase tracking-wider text-neutral-400">{label}</p>
  </div>
)

function CompetitionCard({ c, readOnly, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const fights = c.fights ?? []
  const w = fights.filter((f) => f.result === 'win').length
  const l = fights.filter((f) => f.result === 'loss').length
  return (
    <article className="card space-y-2 !p-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 text-left">
        <span className="w-8 shrink-0 text-center font-display text-2xl leading-none">{MEDAL[c.place] ?? (c.place ? c.place : '·')}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{c.title}</span>
          <span className="block text-xs text-neutral-400">
            {[dayLabel(c.date), c.city, COMP_DISCIPLINES[c.discipline], c.category].filter(Boolean).join(' · ')}
          </span>
          {fights.length > 0 && (
            <span className="mt-0.5 block text-xs text-neutral-400">
              {t('Бои: {w} побед · {l} поражений', { w, l })}
            </span>
          )}
        </span>
        <span className="shrink-0 text-neutral-500" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line pt-2">
          {c.place && <p className="text-sm">{t('Место: {p}', { p: c.place })}</p>}
          {fights.map((f, i) => (
            <div key={i} className="rounded-md border border-line p-2.5 text-sm">
              <p>
                <span className={`font-semibold ${RESULTS[f.result]?.cls ?? ''}`}>{RESULTS[f.result]?.label}</span>
                {f.opponent && <> · {t('против {name}', { name: f.opponent })}</>}
                {f.opponent_club && <span className="text-neutral-400"> ({f.opponent_club})</span>}
              </p>
              <p className="text-xs text-neutral-400">
                {[METHODS[f.method], f.technique, f.time].filter(Boolean).join(' · ')}
              </p>
              {f.review && (
                <p className="mt-1 text-neutral-300">
                  <span className="text-neutral-500">{f.result === 'loss' ? t('Чего не хватило:') : t('Что сработало:')}</span> {f.review}
                </p>
              )}
            </div>
          ))}
          {c.notes && <p className="text-sm text-neutral-300">{c.notes}</p>}
          {!readOnly && (
            <div className="flex gap-3 text-sm">
              <button type="button" onClick={onEdit} className="text-neutral-300 hover:underline">{t('Изменить')}</button>
              <button type="button" onClick={onDelete} className="text-accent hover:underline">{t('Удалить')}</button>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function CompetitionForm({ userId, value, onSaved, onCancel }) {
  const [c, setC] = useState(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setC((x) => ({ ...x, [k]: e.target.value }))
  const setFight = (i, k, v) => setC((x) => ({ ...x, fights: x.fights.map((f, n) => (n === i ? { ...f, [k]: v } : f)) }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSaved(await saveCompetition(userId, c))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <p className="label">{c.id ? t('Изменить турнир') : t('Новый турнир')}</p>
      <div>
        <label className="label" htmlFor="comp-title">{t('Турнир *')}</label>
        <input id="comp-title" className="input" required minLength={2} maxLength={160} placeholder={t('Например: Чемпионат Латвии по грэпплингу')} value={c.title} onChange={set('title')} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="comp-date">{t('Когда *')}</label>
          <input id="comp-date" type="date" className="input" required value={c.date} onChange={set('date')} />
        </div>
        <div>
          <label className="label" htmlFor="comp-city">{t('Где')}</label>
          <input id="comp-city" className="input" maxLength={120} placeholder={t('Город, зал')} value={c.city} onChange={set('city')} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="comp-disc">{t('Направление')}</label>
          <select id="comp-disc" className="input" value={c.discipline} onChange={set('discipline')}>
            {Object.entries(COMP_DISCIPLINES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="comp-cat">{t('Категория')}</label>
          <input id="comp-cat" className="input" maxLength={120} placeholder={t('-77 кг, взрослые')} value={c.category} onChange={set('category')} />
        </div>
      </div>
      <div>
        <p className="label">{t('Место')}</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            ['1', '🥇 1'],
            ['2', '🥈 2'],
            ['3', '🥉 3'],
            ['', t('Без медали')],
          ].map(([v, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setC((x) => ({ ...x, place: v }))}
              className={`rounded-full border px-3 py-1.5 text-sm ${String(c.place) === v ? 'border-accent bg-accent/15 text-white' : 'border-line text-neutral-400'}`}
            >
              {label}
            </button>
          ))}
          <input
            type="number"
            min={4}
            max={64}
            inputMode="numeric"
            className="input !w-20 !py-1.5 text-sm"
            placeholder={t('4+')}
            aria-label={t('Другое место')}
            value={Number(c.place) > 3 ? c.place : ''}
            onChange={(e) => setC((x) => ({ ...x, place: e.target.value }))}
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="label">{t('Бои')}</p>
        {c.fights.map((f, i) => (
          <div key={i} className="space-y-2 rounded-md border border-line p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{t('Бой {n}', { n: i + 1 })}</p>
              <button type="button" onClick={() => setC((x) => ({ ...x, fights: x.fights.filter((_, n) => n !== i) }))} className="text-xs text-accent hover:underline">
                {t('Убрать')}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t('Результат')}>
              {Object.entries(RESULTS).map(([k, r]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={f.result === k}
                  onClick={() => setFight(i, 'result', k)}
                  className={`rounded-md border py-2 text-sm font-semibold ${f.result === k ? 'border-accent bg-accent/15 text-white' : 'border-line text-neutral-400'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" maxLength={80} placeholder={t('Соперник')} aria-label={t('Соперник')} value={f.opponent} onChange={(e) => setFight(i, 'opponent', e.target.value)} />
              <input className="input" maxLength={80} placeholder={t('Его клуб')} aria-label={t('Клуб соперника')} value={f.opponent_club} onChange={(e) => setFight(i, 'opponent_club', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select className="input" aria-label={t('Как закончился бой')} value={f.method} onChange={(e) => setFight(i, 'method', e.target.value)}>
                {Object.entries(METHODS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <input className="input" maxLength={20} placeholder={t('Время, напр. 2:35')} aria-label={t('Время')} value={f.time} onChange={(e) => setFight(i, 'time', e.target.value)} />
            </div>
            <input
              className="input"
              maxLength={80}
              placeholder={f.result === 'loss' ? t('Чем поймали (напр. удушение сзади)') : t('Каким приёмом (напр. удушение сзади)')}
              aria-label={t('Приём')}
              value={f.technique}
              onChange={(e) => setFight(i, 'technique', e.target.value)}
            />
            <textarea
              className="input"
              rows={2}
              maxLength={600}
              placeholder={f.result === 'loss' ? t('Чего не хватило: выносливости, защиты от прохода, захвата…') : t('Что сработало и что можно было сделать лучше')}
              aria-label={f.result === 'loss' ? t('Чего не хватило') : t('Что сработало')}
              value={f.review}
              onChange={(e) => setFight(i, 'review', e.target.value)}
            />
          </div>
        ))}
        <button type="button" onClick={() => setC((x) => ({ ...x, fights: [...x.fights, emptyFight()] }))} className="btn-outline w-full !py-2 text-sm">
          {t('+ Добавить бой')}
        </button>
      </div>

      <textarea className="input" rows={2} maxLength={2000} placeholder={t('Общие впечатления от турнира (необязательно)')} value={c.notes} onChange={set('notes')} />
      {error && <p className="text-sm text-accent">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary flex-1 disabled:opacity-60">{busy ? t('Сохраняю…') : t('Сохранить')}</button>
        <button type="button" onClick={onCancel} className="btn-outline flex-1">{t('Отмена')}</button>
      </div>
    </form>
  )
}

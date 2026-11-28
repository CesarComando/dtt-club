import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { KINDS, deleteEvent, loadPastEvents, loadUpcomingEvents, saveEvent } from '../lib/events.js'
import EventCard from '../components/EventCard.jsx'
import { t } from '../lib/i18n.jsx'

const EMPTY = { title: '', kind: 'competition', starts_on: '', ends_on: '', start_time: '', place: '', description: '' }

// Слой 53: «События» — соревнования, опен маты, семинары. Главный тренер добавляет, ученики получают уведомление.
export default function Events() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [upcoming, setUpcoming] = useState(null)
  const [past, setPast] = useState([])
  const [showPast, setShowPast] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    loadUpcomingEvents().then(setUpcoming).catch((e) => setError(e.message))
    loadPastEvents().then(setPast).catch(() => {})
  }, [])
  useEffect(load, [load])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.starts_on) return setError(t('Нужны название и дата'))
    if (form.ends_on && form.ends_on < form.starts_on) return setError(t('Дата окончания раньше начала'))
    setBusy(true)
    setError('')
    try {
      await saveEvent(form)
      setForm(null)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (ev) => {
    if (!window.confirm(t('Удалить событие «{title}»?', { title: ev.title }))) return
    try {
      await deleteEvent(ev.id)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const adminButtons = (ev) =>
    isAdmin && (
      <div className="flex gap-4 pt-1 text-xs">
        <button type="button" className="text-neutral-400 hover:text-white" onClick={() => setForm({ ...EMPTY, ...ev, ends_on: ev.ends_on ?? '', start_time: ev.start_time?.slice(0, 5) ?? '', place: ev.place ?? '', description: ev.description ?? '' })}>
          {t('Изменить')}
        </button>
        <button type="button" className="text-neutral-400 hover:text-accent" onClick={() => remove(ev)}>
          {t('Удалить')}
        </button>
      </div>
    )

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-3xl">{t('События')}</h1>
        {isAdmin && !form && (
          <button type="button" className="btn-primary !py-2" onClick={() => setForm(EMPTY)}>
            {t('＋ Событие')}
          </button>
        )}
      </div>
      <p className="text-sm text-neutral-400">{t('Соревнования, опен маты и семинары клуба.')}</p>

      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>}

      {form && (
        <form onSubmit={save} className="card space-y-3">
          <h2 className="text-xl">{form.id ? t('Изменить событие') : t('Новое событие')}</h2>
          <label className="block space-y-1">
            <span className="label">{t('Название *')}</span>
            <input className="input" maxLength={200} value={form.title} onChange={set('title')} placeholder={t('Например: Чемпионат Латвии по грэпплингу')} />
          </label>
          <label className="block space-y-1">
            <span className="label">{t('Тип')}</span>
            <select className="input" value={form.kind} onChange={set('kind')}>
              {Object.entries(KINDS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="label">{t('Дата *')}</span>
              <input className="input" type="date" value={form.starts_on} onChange={set('starts_on')} />
            </label>
            <label className="block space-y-1">
              <span className="label">{t('Время')}</span>
              <input className="input" type="time" value={form.start_time} onChange={set('start_time')} />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="label">{t('До (если несколько дней)')}</span>
            <input className="input" type="date" value={form.ends_on} onChange={set('ends_on')} />
          </label>
          <label className="block space-y-1">
            <span className="label">{t('Где')}</span>
            <input className="input" maxLength={200} value={form.place} onChange={set('place')} placeholder={t('Город, зал')} />
          </label>
          <label className="block space-y-1">
            <span className="label">{t('Описание')}</span>
            <textarea className="input" rows={4} maxLength={3000} value={form.description} onChange={set('description')} />
          </label>
          {!form.id && <p className="text-xs text-neutral-500">{t('Ученики получат уведомление в кабинете.')}</p>}
          <div className="flex gap-3">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? t('Сохраняем…') : t('Сохранить')}
            </button>
            <button type="button" className="btn-outline" onClick={() => { setForm(null); setError('') }}>
              {t('Отмена')}
            </button>
          </div>
        </form>
      )}

      <section className="space-y-3">
        <h2 className="text-xl">{t('Ближайшие')}</h2>
        {upcoming === null ? (
          <p className="text-sm text-neutral-400">{t('Загружаем…')}</p>
        ) : upcoming.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('Пока ничего не запланировано.')}</p>
        ) : (
          upcoming.map((ev) => (
            <EventCard key={ev.id} event={ev} full>
              {adminButtons(ev)}
            </EventCard>
          ))
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-3">
          <button type="button" className="text-sm text-neutral-400 hover:text-white" onClick={() => setShowPast((v) => !v)}>
            {showPast ? t('Скрыть прошедшие') : t('Прошедшие · {n}', { n: past.length })}
          </button>
          {showPast &&
            past.map((ev) => (
              <EventCard key={ev.id} event={ev} full>
                {adminButtons(ev)}
              </EventCard>
            ))}
        </section>
      )}
    </div>
  )
}

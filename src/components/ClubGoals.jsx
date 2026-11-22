import { useCallback, useEffect, useState } from 'react'
import { loadCoachStats } from '../lib/coach.js'
import { t, locale } from '../lib/i18n.jsx'
import { MONTH_AIM, loadGoal, monthKey, nextStep, saveGoal, weeklyBaseline } from '../lib/clubGoals.js'

// Цели клуба: пока только один месяц и один показатель —
// среднее число разных участников в неделю за 4 полные недели.
// Цель хранится в базе (видна на телефоне и на компьютере), копия — на устройстве на случай без сети.
const day = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'long' }) : '—')
const num = (x) => (x == null ? '—' : Number(x).toLocaleString(locale(), { maximumFractionDigits: 1 }))
const fill = (s, v) => t(s, Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, k === 'week' ? day(x) : num(x)])))

export default function ClubGoals({ userId }) {
  const month = monthKey()
  const [metrics, setMetrics] = useState(null)
  const [stats, setStats] = useState('loading') // loading | ready | short | error
  const [goal, setGoal] = useState(null)
  const [where, setWhere] = useState('none')
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    setStats('loading')
    const [st, g] = await Promise.allSettled([loadCoachStats(9), loadGoal(userId, month)])
    if (st.status === 'fulfilled') {
      const m = weeklyBaseline(st.value)
      setMetrics(m)
      setStats(m ? 'ready' : 'short')
    } else {
      setMetrics(null)
      setStats('error')
    }
    if (g.status === 'fulfilled') {
      setGoal(g.value.goal)
      setWhere(g.value.where)
      setNote(g.value.note)
      setDraft(g.value.goal?.target ?? '')
      setTitle(g.value.goal?.title ?? '')
    }
  }, [userId, month])

  useEffect(() => {
    refresh()
    const again = () => !document.hidden && refresh()
    document.addEventListener('visibilitychange', again)
    window.addEventListener('online', again)
    return () => {
      document.removeEventListener('visibilitychange', again)
      window.removeEventListener('online', again)
    }
  }, [refresh])

  const store = async (next) => {
    setBusy(true)
    setMsg('')
    try {
      const r = await saveGoal(userId, next, month)
      setGoal(r.goal)
      setWhere(r.where)
      setNote(r.note)
      setMsg(r.where === 'server' ? t('Сохранено — цель видна и на телефоне, и на компьютере.') : t('Сохранено только на этом устройстве — отправлю в базу, когда будет связь.'))
    } catch (e) {
      setMsg(t(e.message))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    const target = Number(draft)
    if (!Number.isInteger(target) || target < 1 || target > 10000) return setMsg(t('Цель — целое число участников в неделю, от 1.'))
    const changed = target !== goal?.target || title.trim() !== (goal?.title ?? '')
    if (!changed) return
    store({ title: title.trim(), target, start: goal?.start ?? metrics?.current ?? null, done: goal?.done ?? [] })
  }

  const step = nextStep(metrics, goal)

  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl">{t('Цель клуба на месяц')}</h2>

      <div className="card space-y-1">
        <p>
          {t('Сейчас')}: <b className="text-xl">{num(metrics?.current)}</b> {t('разных участников в неделю')}
        </p>
        <p className="text-sm text-neutral-400">
          {stats === 'loading' && t('Загружаем…')}
          {stats === 'ready' && t('Среднее за 4 полные недели: с {from} по {to}. Четыре недели до этого: {prev}.', { from: day(metrics.from), to: day(metrics.to), prev: num(metrics.previous) })}
          {stats === 'short' && t('Пока мало данных: нужно 8 полных недель отметок.')}
          {stats === 'error' && t('Статистика недоступна. Проверьте связь и обновите.')}{' '}
          <button type="button" className="underline" onClick={refresh}>{t('Обновить данные')}</button>
        </p>
      </div>

      <div className="card space-y-2 border-accent/60">
        <p className="text-xs uppercase tracking-wider text-neutral-400">{t('Следующий шаг')}</p>
        <p className="font-semibold text-white">{fill(step.text, step.vars)}</p>
        <p className="text-sm text-neutral-300">{t('Почему')}: {fill(step.why, step.vars)}</p>
        {goal && !['nodata', 'set'].includes(step.id) && !(goal.done ?? []).includes(step.id) && (
          <button type="button" disabled={busy} className="btn-outline disabled:opacity-60" onClick={() => store({ ...goal, done: [...(goal.done ?? []), step.id] })}>
            {t('Сделано')}
          </button>
        )}
        {goal && (goal.done ?? []).length > 0 && (
          <button type="button" disabled={busy} className="ml-3 text-xs underline" onClick={() => store({ ...goal, done: [] })}>{t('Начать шаги заново')}</button>
        )}
      </div>

      <form onSubmit={submit} className="card space-y-3">
        <label className="block text-sm">
          {t('Цель')}
          <input className="input mt-1 w-full" value={title} maxLength={140} placeholder={t(MONTH_AIM)} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-sm">
          {t('Сколько разных участников в неделю к концу месяца')}
          <input className="input mt-1 w-40" type="number" inputMode="numeric" min="1" max="10000" step="1" required value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <button disabled={busy} className="btn-primary disabled:opacity-60">{t('Сохранить цель')}</button>
        {goal && (
          <p className="text-sm">
            {goal.title || t(MONTH_AIM)} · {t('на старте')} {num(goal.start)} → {num(goal.target)}
            {metrics ? ` · ${t('осталось')} ${num(Math.max(0, Math.round((goal.target - metrics.current) * 10) / 10))}` : ''}
          </p>
        )}
        <p className="text-xs text-neutral-400" role="status">
          {msg ||
            (where === 'server'
              ? t('Цель хранится в базе клуба — видна на всех ваших устройствах.')
              : where === 'device'
                ? note === 'nolayer'
                  ? t('Цель пока сохранена только на этом устройстве: в базе ещё нет таблицы целей (слой 54).')
                  : t('Нет связи — показана копия с этого устройства.')
                : t('Цель на этот месяц ещё не поставлена.'))}
        </p>
      </form>
    </section>
  )
}

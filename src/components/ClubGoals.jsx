import { useEffect, useState } from 'react'
import { loadCoachStats } from '../lib/coach.js'
import { t, locale } from '../lib/i18n.jsx'
import { horizons, nextSteps, weeklyBaseline } from '../lib/clubGoals.js'

function GoalPeriod({ userId, horizon, metrics }) {
  const key = 'dtt-goal-v1:' + userId + ':' + horizon.id
  const [plan, setPlan] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key))
      if (Number.isInteger(saved?.target) && saved.target > 0) return saved
    } catch { /* An incomplete local plan can be entered again. */ }
    return null
  })
  const [draft, setDraft] = useState(plan?.target ?? '')
  const [title, setTitle] = useState(plan?.title ?? '')
  const [notice, setNotice] = useState('')
  const steps = nextSteps(metrics, plan?.target, horizon)
  function persist(value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
      setPlan(value)
      setNotice(t('Сохранено на этом устройстве'))
    } catch { setNotice(t('Не удалось сохранить на устройстве. Повторите попытку.')) }
  }
  function submit(e) {
    e.preventDefault()
    const target = Number(draft)
    if (!metrics || !Number.isInteger(target) || target < 1 || target > 10000) return
    const changed = target !== plan?.target || title.trim() !== plan?.title
    persist({target, title:title.trim(), start:changed ? metrics.current : plan.start, done:changed ? [] : plan.done})
  }
  const done = plan?.done ?? []
  const next = steps.find(([id]) => !done.includes(id))
  return <div className="card space-y-4">
    <h3 className="font-display text-xl">{t(horizon.aim)}</h3>
    <p>{t('Точка А сейчас')} · <b>{metrics?.current.toLocaleString(locale()) ?? '—'}</b> {t('участников в неделю')}</p>
    <p className="text-sm text-neutral-400">{t('Среднее за четыре полные недели. Предыдущие четыре недели')} · {metrics?.previous.toLocaleString(locale()) ?? '—'}</p>
    {!plan && <p className="text-sm">{t('Первое действие')} · {t(horizon.step)}</p>}
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="grow">{t('Моя цель')}<input className="input w-full" value={title} maxLength={140} placeholder={t(horizon.aim)} onChange={e=>setTitle(e.target.value)} /></label>
      <label>{t('Точка Б, участников в неделю')}<input className="input w-full" type="number" min="1" max="10000" step="1" required value={draft} onChange={e=>setDraft(e.target.value)} /></label>
      <button disabled={!metrics} className="btn-primary">{t('Сохранить цель')}</button>
    </form>
    <p className="text-xs text-neutral-400" role="status">{notice || t('План хранится на этом устройстве для вашего аккаунта.')}</p>
    {plan && metrics && <section className="space-y-3">
      <p>{plan.title || t(horizon.aim)} · {t('На старте')} {plan.start} → {plan.target} · {t('Осталось')} {Math.max(0, plan.target - metrics.current).toLocaleString(locale())}</p>
      <p className="font-semibold text-white">{next ? t('Сейчас') + ' · ' + t(next[1]) : t('Цикл завершён. Сверьте результат и начните следующий цикл.')}</p>
      <ol className="space-y-2">{steps.map(([id,task],i)=><li key={id}><label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={done.includes(id)} onChange={e=>persist({...plan,done:e.target.checked?[...done,id]:done.filter(x=>x!==id)})}/>
        <span>{i+1}. {t(task)}</span>
      </label></li>)}</ol>
      {done.length>0 && <button className="btn-outline" onClick={()=>persist({...plan,done:[]})}>{t('Начать новый цикл')}</button>}
    </section>}
  </div>
}

export default function ClubGoals({userId}) {
  const [id,setId]=useState('month')
  const [metrics,setMetrics]=useState(null)
  const [status,setStatus]=useState('loading')
  const [reload,setReload]=useState(0)
  useEffect(()=>{
    let active=true, sequence=0
    async function refresh() {
      const seq=++sequence
      try {
        const result=weeklyBaseline(await loadCoachStats(9))
        if(active && seq===sequence){setMetrics(result);setStatus(result?'ready':'empty')}
      } catch { if(active && seq===sequence){setMetrics(null);setStatus('error')} }
    }
    refresh()
    const visible=()=>{if(!document.hidden) refresh()}
    document.addEventListener('visibilitychange',visible)
    window.addEventListener('online',visible)
    const timer=setInterval(visible, 15*60*1000)
    return ()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible)}
  },[reload])
  const horizon=horizons.find(h=>h.id===id)
  return <section className="space-y-4">
    <h2 className="font-display text-2xl">{t('План развития клуба')}</h2>
    <div className="flex flex-wrap gap-2">{horizons.map(h=><button key={h.id} aria-pressed={h.id===id} onClick={()=>setId(h.id)} className={h.id===id?'btn-primary':'btn-outline'}>{t(h.title)}</button>)}</div>
    <div className="flex flex-wrap items-center gap-3 text-sm" role="status">
      {status==='loading'?t('Загружаем…'):metrics?t('Учтена неделя с')+' '+metrics.lastWeek:t('Статистика пока недоступна. Проверьте связь и обновите.')}
      <button className="underline" onClick={()=>setReload(n=>n+1)}>{t('Обновить данные')}</button>
    </div>
    <GoalPeriod key={id} userId={userId} horizon={horizon} metrics={metrics}/>
  </section>
}

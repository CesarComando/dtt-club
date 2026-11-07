import { useEffect, useState } from 'react'
import { loadFacts, saveFacts } from '../lib/assistant.js'

// Вкладка «Помощник»: тексты, по которым ИИ-помощник отвечает ученикам.
// Расписание, цены и ближайшие занятия он берёт из базы сам — здесь только остальное.
export default function AdminAssistant() {
  const [body, setBody] = useState('')
  const [saved, setSaved] = useState('')
  const [state, setState] = useState('loading') // loading | ready | saving | error
  const [msg, setMsg] = useState('')

  useEffect(() => {
    loadFacts()
      .then((d) => {
        setBody(d?.body ?? '')
        setSaved(d?.body ?? '')
        setState('ready')
      })
      .catch((e) => {
        setMsg(e.message.includes('club_info') ? 'Сначала выполните supabase/layer32_assistant.sql' : e.message)
        setState('error')
      })
  }, [])

  const save = async () => {
    setState('saving')
    setMsg('')
    try {
      await saveFacts(body)
      setSaved(body)
      setMsg('Сохранено — помощник уже отвечает по новому тексту.')
    } catch (e) {
      setMsg(e.message)
    }
    setState('ready')
  }

  return (
    <section className="card space-y-3">
      <div>
        <p className="label">Помощник «Спросить»</p>
        <p className="text-sm text-neutral-400">
          Что знает ИИ-помощник учеников. Расписание, цены и ближайшие занятия он берёт из приложения сам,
          а абонемент и записи — только самого ученика. Пишите сюда правила, что взять, возраст групп, контакты.
        </p>
      </div>
      {state === 'loading' && <p className="text-sm text-neutral-500">Загрузка…</p>}
      {state !== 'loading' && state !== 'error' && (
        <>
          <textarea className="input min-h-[320px] font-mono text-xs leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} />
          <button type="button" className="btn-primary" disabled={state === 'saving' || body === saved} onClick={save}>
            {state === 'saving' ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </>
      )}
      {msg && <p className={`text-sm ${state === 'error' ? 'text-accent' : 'text-emerald-400'}`}>{msg}</p>}
    </section>
  )
}

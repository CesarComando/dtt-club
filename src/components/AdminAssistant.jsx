import { useEffect, useState } from 'react'
import { loadFacts, saveFacts } from '../lib/assistant.js'
import { t } from '../lib/i18n.jsx'

// Вкладка «Помощник»: тексты, по которым ИИ-помощник отвечает ученикам.
// Расписание, цены и ближайшие занятия он берёт из базы сам — здесь только остальное.
export default function AdminAssistant() {
  const [body, setBody] = useState('')
  const [saved, setSaved] = useState('')
  const [state, setState] = useState('loading') // loading | ready | saving | error
  const [msg, setMsg] = useState('')
  const [failed, setFailed] = useState(false) // последнее сохранение не удалось — показываем красным

  useEffect(() => {
    loadFacts()
      .then((d) => {
        setBody(d?.body ?? '')
        setSaved(d?.body ?? '')
        setState('ready')
      })
      .catch((e) => {
        setMsg(e.message.includes('club_info') ? t('Сначала выполните supabase/layer32_assistant.sql') : e.message)
        setState('error')
      })
  }, [])

  const save = async () => {
    setState('saving')
    setMsg('')
    setFailed(false)
    try {
      await saveFacts(body)
      setSaved(body)
      setMsg(t('Сохранено — помощник уже отвечает по новому тексту.'))
    } catch (e) {
      setFailed(true)
      setMsg(`${t('Не сохранилось:')} ${e.message}`)
    }
    setState('ready')
  }

  return (
    <section className="card space-y-3">
      <div>
        <p className="label">{t('Помощник «Спросить»')}</p>
        <p className="text-sm text-neutral-400">
          {t('Что знает ИИ-помощник учеников. Расписание, цены и ближайшие занятия он берёт из приложения сам, а абонемент и записи — только самого ученика. Пишите сюда правила, что взять, возраст групп, контакты.')}
        </p>
      </div>
      {state === 'loading' && <p className="text-sm text-neutral-500">{t('Загрузка…')}</p>}
      {state !== 'loading' && state !== 'error' && (
        <>
          <textarea className="input min-h-[320px] font-mono text-xs leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} />
          <button type="button" className="btn-primary" disabled={state === 'saving' || body === saved} onClick={save}>
            {state === 'saving' ? t('Сохраняю…') : t('Сохранить')}
          </button>
          {body === saved && state === 'ready' && !msg && (
            <p className="text-xs text-neutral-500">{t('Этот текст уже сохранён и работает. Измените его — кнопка «Сохранить» станет активной.')}</p>
          )}
        </>
      )}
      {msg && <p className={`text-sm ${state === 'error' || failed ? 'text-accent' : 'text-emerald-400'}`}>{msg}</p>}
    </section>
  )
}

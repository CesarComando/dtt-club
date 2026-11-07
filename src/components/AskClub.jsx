import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { askClub } from '../lib/assistant.js'

// Кнопка «Спросить» (справа внизу, над таб-баром) и окно чата с помощником клуба.
// Помощник отвечает по фактам клуба и по абонементу/записям самого ученика.
const HINTS = [
  'До какого числа мой абонемент?',
  'Когда моя следующая тренировка?',
  'Сколько стоит абонемент?',
  'Что взять на первую тренировку?',
]

export default function AskClub() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, busy])
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Только для вошедших; в панели тренера и на экране отметки кнопка не нужна.
  if (!user || pathname.startsWith('/admin') || pathname.startsWith('/checkin')) return null

  const send = async (q) => {
    const question = (q ?? text).trim()
    if (!question || busy) return
    const next = [...messages, { role: 'user', content: question }]
    setMessages(next)
    setText('')
    setError('')
    setBusy(true)
    try {
      const answer = await askClub(next)
      setMessages([...next, { role: 'assistant', content: answer }])
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-4 z-40 flex items-center gap-2 rounded-full bg-accent px-4 py-3 font-display text-sm uppercase tracking-wider text-white shadow-lg shadow-black/60 hover:bg-accent/90 md:bottom-6"
          aria-label="Спросить помощника клуба"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
          </svg>
          Спросить
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 md:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="Помощник клуба"
            className="flex h-[85dvh] w-full max-w-lg flex-col rounded-t-xl border border-line bg-ink md:h-[70vh] md:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="border-l-4 border-accent pl-3">
                <p className="font-display text-lg uppercase tracking-wider">Помощник клуба</p>
                <p className="text-xs text-neutral-500">Отвечает ИИ по данным клуба. Важное уточняйте у тренера.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="p-2 text-neutral-400 hover:text-white" aria-label="Закрыть">✕</button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {!messages.length && (
                <div className="space-y-3">
                  <p className="text-sm text-neutral-300">Спросите про расписание, цены, правила или свой абонемент.</p>
                  <div className="flex flex-wrap gap-2">
                    {HINTS.map((h) => (
                      <button key={h} type="button" onClick={() => send(h)}
                        className="rounded-full border border-line px-3 py-1.5 text-left text-xs text-neutral-200 hover:border-accent">
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <p className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    m.role === 'user' ? 'bg-accent text-white' : 'border border-line bg-white/5 text-neutral-100'}`}>
                    {m.content}
                  </p>
                </div>
              ))}
              {busy && <p className="text-sm text-neutral-500">Помощник печатает…</p>}
              {error && <p className="text-sm text-accent">{error}</p>}
              <div ref={endRef} />
            </div>

            <form
              className="flex gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
            >
              <input
                className="input flex-1"
                placeholder="Ваш вопрос…"
                value={text}
                maxLength={1000}
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" disabled={busy || !text.trim()} className="btn-primary !px-4 disabled:opacity-50">→</button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

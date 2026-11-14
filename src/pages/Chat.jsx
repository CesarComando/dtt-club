import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { fullName, loadMessages, loadMyFriends, markChatRead, removeFriend, sendMessage, subscribeChat } from '../lib/chat.js'
import { t } from '../lib/i18n.jsx'
import { Avatar } from './Friends.jsx'

const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const day = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'long' })

// Переписка с одним другом. Новые сообщения приходят сразу (Realtime).
export default function Chat() {
  const { id: other } = useParams()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [friend, setFriend] = useState(undefined) // undefined — грузим, null — не друг
  const [msgs, setMsgs] = useState([])
  const [more, setMore] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [menu, setMenu] = useState(false)
  const bottom = useRef(null)
  const stick = useRef(true)

  const me = user?.id

  const refresh = useCallback(async () => {
    if (!me) return
    const list = await loadMessages(me, other)
    setMsgs((old) => {
      // сохраняем подгруженные ранее старые сообщения
      const ids = new Set(list.map((m) => m.id))
      const earlier = old.filter((m) => !ids.has(m.id) && (!list[0] || m.created_at < list[0].created_at))
      return [...earlier, ...list]
    })
    if (list.some((m) => m.sender === other && !m.read_at)) {
      await markChatRead(other).catch(() => {})
      window.dispatchEvent(new Event('dtt-chat-read'))
    }
    return list
  }, [me, other])

  useEffect(() => {
    if (!me) return
    loadMyFriends()
      .then((l) => setFriend(l.find((f) => f.id === other && f.status === 'accepted') ?? null))
      .catch(() => setFriend(null))
    refresh().then((l) => setMore((l?.length ?? 0) >= 50)).catch((e) => setErr(e.message))
    return subscribeChat(me, () => refresh().catch(() => {}))
  }, [me, other, refresh])

  useLayoutEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ block: 'end' })
  }, [msgs])

  if (loading) return null
  if (!user) return <Navigate to="/login" replace />

  const send = async (e) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setErr('')
    try {
      const m = await sendMessage(other, body)
      setText('')
      stick.current = true
      setMsgs((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]))
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setSending(false)
    }
  }

  const older = async () => {
    stick.current = false
    const l = await loadMessages(me, other, { before: msgs[0]?.created_at }).catch(() => [])
    setMore(l.length >= 50)
    setMsgs((old) => [...l, ...old])
  }

  const unfriend = async () => {
    if (!window.confirm(t('Удалить из друзей? Переписка сохранится, но писать друг другу будет нельзя.'))) return
    await removeFriend(other).catch((e) => setErr(e.message))
    navigate('/friends')
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col">
      <header className="sticky top-0 z-10 -mx-4 flex items-center gap-3 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur md:top-16">
        <Link to="/friends" className="text-2xl leading-none text-neutral-400 hover:text-white" aria-label={t('Назад')}>
          ‹
        </Link>
        {friend && <Avatar p={friend} size="h-9 w-9" />}
        <span className="min-w-0 flex-1 truncate font-semibold">{friend ? fullName(friend) : friend === null ? t('Переписка') : ''}</span>
        {friend && (
          <div className="relative">
            <button onClick={() => setMenu((v) => !v)} className="px-2 text-xl text-neutral-400 hover:text-white" aria-label={t('Ещё')}>
              ⋯
            </button>
            {menu && (
              <button onClick={unfriend} className="absolute right-0 top-8 whitespace-nowrap rounded-md border border-line bg-ink px-3 py-2 text-sm text-red-400 shadow-lg">
                {t('Удалить из друзей')}
              </button>
            )}
          </div>
        )}
      </header>

      <div className="space-y-1 py-4">
        {more && (
          <button onClick={older} className="mx-auto block text-xs text-neutral-400 hover:text-white">
            {t('Показать раньше')}
          </button>
        )}
        {!msgs.length && friend && <p className="py-10 text-center text-sm text-neutral-500">{t('Напишите первое сообщение')}</p>}
        {msgs.map((m, i) => {
          const mine = m.sender === me
          const newDay = i === 0 || day(m.created_at) !== day(msgs[i - 1].created_at)
          return (
            <div key={m.id}>
              {newDay && <p className="py-2 text-center text-xs text-neutral-500">{day(m.created_at)}</p>}
              <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[15px] ${
                    mine ? 'rounded-br-sm bg-accent text-white' : 'rounded-bl-sm bg-line text-neutral-100'
                  }`}
                >
                  {m.body}
                  <span className={`ml-2 align-bottom text-[10px] ${mine ? 'text-white/70' : 'text-neutral-400'}`}>
                    {time(m.created_at)}
                    {mine && (m.read_at ? ' ✓✓' : ' ✓')}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      {err && <p className="pb-2 text-sm text-red-400">{err}</p>}
      {friend === null ? (
        <p className="card text-sm text-neutral-400">{t('Писать можно только друзьям.')} <Link to="/friends" className="text-accent">{t('К друзьям')}</Link></p>
      ) : (
        <form onSubmit={send} className="sticky bottom-20 flex items-end gap-2 bg-ink py-2 md:bottom-0">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 768px)').matches) send(e)
            }}
            rows={1}
            maxLength={2000}
            placeholder={t('Сообщение…')}
            className="input max-h-32 min-h-[44px] flex-1 resize-none"
            disabled={!friend}
          />
          <button type="submit" disabled={!text.trim() || sending || !friend} className="btn-primary !px-4 !py-2.5" aria-label={t('Отправить')}>
            ➤
          </button>
        </form>
      )}
    </div>
  )
}

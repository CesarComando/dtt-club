import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import {
  fullName,
  initials,
  loadChatPeople,
  loadMyFriends,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  subscribeChat,
} from '../lib/chat.js'
import { t } from '../lib/i18n.jsx'

export function Avatar({ p, size = 'h-11 w-11' }) {
  return p?.photo ? (
    <img src={p.photo} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-line font-display text-sm text-neutral-300`}>
      {initials(p)}
    </span>
  )
}

const ROLE = { coach: 'Тренер', admin: 'Главный тренер' }

function when(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

// Друзья: переписки, входящие заявки, поиск людей клуба.
export default function Friends() {
  const { user, profile, loading } = useAuth()
  const [friends, setFriends] = useState(null)
  const [people, setPeople] = useState(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')

  const reload = useCallback(() => {
    loadMyFriends().then(setFriends).catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (!user) return
    reload()
    return subscribeChat(user.id, reload)
  }, [user, reload])

  // Список всех людей грузим, только когда начали искать.
  useEffect(() => {
    if (q && !people) loadChatPeople().then(setPeople).catch((e) => setErr(e.message))
  }, [q, people])

  const byId = useMemo(() => Object.fromEntries((friends ?? []).map((f) => [f.id, f])), [friends])
  const found = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s || !people) return []
    return people.filter((p) => fullName(p).toLowerCase().includes(s)).slice(0, 30)
  }, [q, people])

  if (loading) return null
  if (!user) return <Navigate to="/login?next=/friends" replace />

  const act = async (id, fn) => {
    setBusy(id)
    setErr('')
    try {
      await fn()
      reload()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }

  const incoming = (friends ?? []).filter((f) => f.status === 'incoming')
  const accepted = (friends ?? []).filter((f) => f.status === 'accepted')
  const outgoing = (friends ?? []).filter((f) => f.status === 'outgoing')
  const notApproved = profile && !profile.approved_at && !['admin', 'coach'].includes(profile.role)

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="font-display text-3xl uppercase tracking-wider">
        {t('Друзья')} <span className="text-accent">·</span> {t('чат')}
      </h1>

      {notApproved && (
        <p className="card text-sm text-neutral-300">{t('Друзья и переписка откроются, когда тренер подтвердит ваш аккаунт.')}</p>
      )}
      {err && <p className="text-sm text-red-400">{err}</p>}

      {incoming.length > 0 && (
        <section className="card space-y-3 border-accent/60">
          <h2 className="font-display uppercase tracking-wider text-accent">{t('Заявки в друзья')}</h2>
          {incoming.map((f) => (
            <div key={f.id} className="flex items-center gap-3">
              <Avatar p={f} />
              <span className="min-w-0 flex-1 truncate font-semibold">{fullName(f)}</span>
              <button disabled={busy === f.id} onClick={() => act(f.id, () => respondFriendRequest(f.id, true))} className="btn-primary !px-3 !py-1.5 text-sm">
                {t('Принять')}
              </button>
              <button disabled={busy === f.id} onClick={() => act(f.id, () => respondFriendRequest(f.id, false))} className="text-sm text-neutral-400 hover:text-white">
                {t('Нет')}
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('Найти человека из клуба…')}
          className="input"
          disabled={notApproved}
        />
        {q && (
          <div className="card divide-y divide-line !p-0">
            {!people && <p className="p-3 text-sm text-neutral-400">{t('Загрузка…')}</p>}
            {people && !found.length && <p className="p-3 text-sm text-neutral-400">{t('Никого не нашли')}</p>}
            {found.map((p) => {
              const st = byId[p.id]?.status
              return (
                <div key={p.id} className="flex items-center gap-3 p-3">
                  <Avatar p={p} size="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{fullName(p)}</p>
                    {ROLE[p.role] && <p className="text-xs text-accent">{t(ROLE[p.role])}</p>}
                  </div>
                  {st === 'accepted' ? (
                    <Link to={`/chat/${p.id}`} className="btn-outline !px-3 !py-1.5 text-sm">
                      {t('Написать')}
                    </Link>
                  ) : st === 'outgoing' ? (
                    <span className="text-xs text-neutral-400">{t('Заявка отправлена')}</span>
                  ) : st === 'incoming' ? (
                    <button disabled={busy === p.id} onClick={() => act(p.id, () => respondFriendRequest(p.id, true))} className="btn-primary !px-3 !py-1.5 text-sm">
                      {t('Принять')}
                    </button>
                  ) : (
                    <button disabled={busy === p.id} onClick={() => act(p.id, () => sendFriendRequest(p.id))} className="btn-primary !px-3 !py-1.5 text-sm">
                      {t('Добавить')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        {friends === null && <p className="text-sm text-neutral-400">{t('Загрузка…')}</p>}
        {friends && !accepted.length && !q && (
          <p className="text-sm text-neutral-400">{t('Пока нет друзей. Найдите ребят из клуба через поиск выше и добавьте их — после того как они примут заявку, можно переписываться.')}</p>
        )}
        {accepted.map((f) => (
          <Link key={f.id} to={`/chat/${f.id}`} className="card flex items-center gap-3 !p-3 hover:border-accent/60">
            <Avatar p={f} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate font-semibold">{fullName(f)}</span>
                <span className="ml-auto shrink-0 text-xs text-neutral-500">{when(f.last_at)}</span>
              </div>
              <p className={`truncate text-sm ${f.unread ? 'text-white' : 'text-neutral-400'}`}>
                {f.last_body ? (f.last_mine ? `${t('Вы')}: ` : '') + f.last_body : ROLE[f.role] ? t(ROLE[f.role]) : t('Напишите первым')}
              </p>
            </div>
            {f.unread > 0 && (
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-white">{f.unread}</span>
            )}
          </Link>
        ))}
      </section>

      {outgoing.length > 0 && (
        <section className="space-y-2 text-sm">
          <h2 className="font-display uppercase tracking-wider text-neutral-400">{t('Ждут ответа')}</h2>
          {outgoing.map((f) => (
            <div key={f.id} className="flex items-center gap-3">
              <Avatar p={f} size="h-8 w-8" />
              <span className="min-w-0 flex-1 truncate text-neutral-300">{fullName(f)}</span>
              <button disabled={busy === f.id} onClick={() => act(f.id, () => removeFriend(f.id))} className="text-xs text-neutral-500 hover:text-white">
                {t('Отменить')}
              </button>
            </div>
          ))}
        </section>
      )}

      <p className="text-xs text-neutral-500">
        {t('Переписку видите только вы и ваш собеседник — тренер чужие сообщения не читает. Детские аккаунты в друзья не добавляются.')}
      </p>
    </div>
  )
}

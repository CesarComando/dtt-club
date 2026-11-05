import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { sessionDay, sessionTime, shareInvite } from '../lib/booking.js'
import { inviteFriend, loadClubPeople } from '../lib/friends.js'

// «Позвать друга»: выбрать из учеников, уже зарегистрированных в приложении
// (видны только имя и фото), или отправить ссылку тому, кого в приложении ещё нет.
export default function FriendPicker({ session, onClose }) {
  const { user } = useAuth()
  const [people, setPeople] = useState(null)
  const [q, setQ] = useState('')
  const [sent, setSent] = useState({}) // id → 'ok' | текст ошибки
  const [busy, setBusy] = useState(null)
  const [linkMsg, setLinkMsg] = useState('')

  useEffect(() => {
    loadClubPeople({ photos: true })
      .then((list) => setPeople(list.filter((p) => p.id !== user?.id)))
      .catch(() => setPeople([]))
  }, [user?.id])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (people ?? []).filter((p) => !s || `${p.first_name} ${p.last_name}`.toLowerCase().includes(s))
  }, [people, q])

  const invite = async (p) => {
    setBusy(p.id)
    try {
      await inviteFriend(session.id, p.id)
      setSent((m) => ({ ...m, [p.id]: 'ok' }))
    } catch (e) {
      setSent((m) => ({ ...m, [p.id]: e.message }))
    } finally {
      setBusy(null)
    }
  }

  const shareLink = async () => {
    try {
      const r = await shareInvite(session)
      if (r !== 'cancelled') setLinkMsg(r === 'copied' ? 'Ссылка скопирована — отправьте другу' : 'Ссылка отправлена')
    } catch (e) {
      setLinkMsg(e.message)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 sm:items-center" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-xl border border-line bg-panel sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl">Позвать на тренировку</h2>
              <p className="text-sm text-neutral-400">{sessionDay(session.starts_at)} · {sessionTime(session)} · {session.title}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Закрыть" className="text-2xl leading-none text-neutral-400 hover:text-white">✕</button>
          </div>
          <input className="input" type="search" placeholder="Найти по имени…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto px-4">
          {people == null ? (
            <li className="py-4 text-sm text-neutral-400">Загружаем…</li>
          ) : list.length === 0 ? (
            <li className="py-4 text-sm text-neutral-400">Никого не нашли — отправьте ссылку ниже.</li>
          ) : (
            list.map((p) => {
              const st = sent[p.id]
              return (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink text-sm font-display">
                    {p.photo ? <img src={p.photo} alt="" className="h-full w-full object-cover" /> : `${p.first_name[0] ?? ''}${p.last_name[0] ?? ''}`}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{p.first_name} {p.last_name}</p>
                    {st && st !== 'ok' && <p className="text-xs text-accent">{st}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={busy === p.id || st === 'ok'}
                    onClick={() => invite(p)}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold ${st === 'ok' ? 'text-emerald-400' : 'border border-accent text-white hover:bg-accent/15'} disabled:opacity-70`}
                  >
                    {busy === p.id ? '…' : st === 'ok' ? '✓ Позван' : 'Позвать'}
                  </button>
                </li>
              )
            })
          )}
        </ul>

        <div className="space-y-2 border-t border-line p-4">
          <button type="button" onClick={shareLink} className="btn-outline w-full">Отправить ссылку (кого нет в приложении)</button>
          {linkMsg && <p className="text-center text-xs text-neutral-400">{linkMsg}</p>}
          <p className="text-center text-xs text-neutral-500">Друг увидит приглашение у себя в кабинете. Телефоны никому не показываются.</p>
        </div>
      </div>
    </div>
  )
}

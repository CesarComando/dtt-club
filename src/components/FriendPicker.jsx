import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { sessionDay, sessionTime, shareInvite } from '../lib/booking.js'
import { inviteFriend, loadAttendees, loadClubPeople } from '../lib/friends.js'
import { t, tData } from '../lib/i18n.jsx'

// «Позвать друга»: выбрать из учеников, уже зарегистрированных в приложении
// (видны только имя и фото), или отправить ссылку тому, кого в приложении ещё нет.
export default function FriendPicker({ session, onClose }) {
  const { user } = useAuth()
  const [people, setPeople] = useState(null)
  const [q, setQ] = useState('')
  const [sent, setSent] = useState({}) // id → 'ok' | текст ошибки
  const [busy, setBusy] = useState(null)
  const [linkMsg, setLinkMsg] = useState('')
  const [going, setGoing] = useState(null) // { people, hidden } — кто уже записан

  useEffect(() => {
    loadClubPeople({ photos: true })
      .then((list) => setPeople(list.filter((p) => p.id !== user?.id)))
      .catch(() => setPeople([]))
  }, [user?.id])

  useEffect(() => {
    loadAttendees([session.id], { photos: true })
      .then((m) => setGoing(m[session.id] ?? { people: [], hidden: 0 }))
      .catch(() => setGoing({ people: [], hidden: 0 }))
  }, [session.id])
  const goingIds = useMemo(() => new Set((going?.people ?? []).map((p) => p.id)), [going])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (people ?? [])
      .filter((p) => !s || `${p.first_name} ${p.last_name}`.toLowerCase().includes(s))
      // кто уже записан — в конце списка, с отметкой «✓ Идёт»
      .sort((a, b) => goingIds.has(a.id) - goingIds.has(b.id))
  }, [people, q, goingIds])

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
      if (r !== 'cancelled') setLinkMsg(r === 'copied' ? t('Ссылка скопирована — отправьте другу') : t('Ссылка отправлена'))
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
              <h2 className="text-xl">{t('Позвать на тренировку')}</h2>
              <p className="text-sm text-neutral-400">{sessionDay(session.starts_at)} · {sessionTime(session)} · {tData(session.title)}</p>
            </div>
            <button type="button" onClick={onClose} aria-label={t('Закрыть')} className="text-2xl leading-none text-neutral-400 hover:text-white">✕</button>
          </div>
          {going && (going.people.length > 0 || going.hidden > 0) && (
            <div>
              <p className="label">{t('Уже идут')} · {going.people.length + going.hidden}</p>
              <div className="flex flex-wrap gap-2">
                {going.people.map((p) => (
                  <span key={p.id} className="flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2.5 text-xs">
                    <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-ink text-[10px] font-display">
                      {p.photo ? <img src={p.photo} alt="" className="h-full w-full object-cover" /> : `${p.first_name[0] ?? ''}${p.last_name[0] ?? ''}`}
                    </span>
                    {p.id === user?.id ? t('Вы') :`${p.first_name} ${p.last_name[0] ?? ''}.`}
                  </span>
                ))}
                {going.hidden > 0 && <span className="rounded-full border border-line px-2.5 py-1 text-xs text-neutral-400">{t('ещё {n}', { n: going.hidden })}</span>}
              </div>
            </div>
          )}
          <input className="input" type="search" placeholder={t('Найти по имени…')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto px-4">
          {people == null ? (
            <li className="py-4 text-sm text-neutral-400">{t('Загружаем…')}</li>
          ) : list.length === 0 ? (
            <li className="py-4 text-sm text-neutral-400">{t('Никого не нашли — отправьте ссылку ниже.')}</li>
          ) : (
            list.map((p) => {
              const st = sent[p.id]
              const isGoing = goingIds.has(p.id)
              return (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink text-sm font-display">
                    {p.photo ? <img src={p.photo} alt="" className="h-full w-full object-cover" /> : `${p.first_name[0] ?? ''}${p.last_name[0] ?? ''}`}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{p.first_name} {p.last_name}</p>
                    {st && st !== 'ok' && <p className="text-xs text-accent">{st}</p>}
                  </div>
                  {isGoing ? (
                    <span className="shrink-0 px-3 py-1.5 text-xs font-semibold text-emerald-400">{t('✓ Идёт')}</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === p.id || st === 'ok'}
                      onClick={() => invite(p)}
                      className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold ${st === 'ok' ? 'text-emerald-400' : 'border border-accent text-white hover:bg-accent/15'} disabled:opacity-70`}
                    >
                      {busy === p.id ? '…' : st === 'ok' ? `✓ ${t('Позван')}` : t('Позвать')}
                    </button>
                  )}
                </li>
              )
            })
          )}
        </ul>

        <div className="space-y-2 border-t border-line p-4">
          <button type="button" onClick={shareLink} className="btn-outline w-full">{t('Отправить ссылку (кого нет в приложении)')}</button>
          {linkMsg && <p className="text-center text-xs text-neutral-400">{linkMsg}</p>}
          <p className="text-center text-xs text-neutral-500">{t('Друг увидит приглашение у себя в кабинете. Телефоны никому не показываются.')}</p>
        </div>
      </div>
    </div>
  )
}

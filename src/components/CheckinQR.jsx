import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabaseClient.js'
import { loadUpcoming, sessionDay, sessionTime } from '../lib/booking.js'
import { checkinUrl, newCheckinToken } from '../lib/club-ops.js'
import { t, tData } from '../lib/i18n.jsx'

const REFRESH_MS = 30_000 // код на экране меняется каждые 30 с (живёт 2 мин)

// Полноэкранный QR для зала: тренер ставит телефон/планшет у входа,
// ученики сканируют камерой и отмечаются сами.
function QrScreen({ session, onClose }) {
  const [img, setImg] = useState('')
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const token = await newCheckinToken(session.id)
      setImg(await QRCode.toDataURL(checkinUrl(token), { width: 640, margin: 2 }))
      const { count: c } = await supabase
        .from('attendance').select('id', { count: 'exact', head: true }).eq('session_id', session.id)
      setCount(c ?? 0)
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [session.id])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-ink p-4 text-center">
      <p className="label">{sessionDay(session.starts_at)} · {sessionTime(session)}</p>
      <h2 className="text-2xl md:text-3xl">{tData(session.title)}</h2>
      <div className="rounded-xl bg-white p-3">
        {img ? <img src={img} alt={t('QR-код для отметки')} className="h-[min(70vw,60vh)] w-[min(70vw,60vh)]" /> : <div className="h-64 w-64" />}
      </div>
      {error ? (
        <p className="text-sm text-accent">{error}</p>
      ) : (
        <p className="text-neutral-300">{t('Наведите камеру телефона на код — тренировка засчитается сама.')}</p>
      )}
      <p className="font-display text-4xl text-accent">{count}</p>
      <p className="-mt-3 text-xs uppercase tracking-wider text-neutral-500">{t('отметились')}</p>
      <button onClick={onClose} className="btn-outline">{t('Закрыть')}</button>
    </div>
  )
}

export default function CheckinQR() {
  const [sessions, setSessions] = useState([])
  const [active, setActive] = useState(null)

  useEffect(() => {
    // Сегодняшние занятия (по Риге) — для них имеет смысл показывать QR.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Riga' })
    loadUpcoming(1)
      .then((list) =>
        setSessions(
          list.filter(
            (s) => !s.cancelled && new Date(s.starts_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Riga' }) === today,
          ),
        ),
      )
      .catch(() => setSessions([]))
  }, [])

  if (!sessions.length) return null

  return (
    <section className="card space-y-3">
      <div>
        <p className="label">{t('QR-чекин')}</p>
        <h2 className="text-xl">{t('Отметка учеников по QR-коду')}</h2>
        <p className="text-sm text-neutral-400">{t('Откройте код на планшете у входа — ученики отметятся сами.')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {sessions.map((s) => (
          <button key={s.id} onClick={() => setActive(s)} className="btn-primary">
            QR · {sessionTime(s)} {tData(s.title)}
          </button>
        ))}
      </div>
      {active && <QrScreen session={active} onClose={() => setActive(null)} />}
    </section>
  )
}

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { acceptInvite, inviteInfo, isFull, seatsText, sessionDay, sessionTime } from '../lib/booking.js'
import { t, tData } from '../lib/i18n.jsx'

// Друг открыл ссылку «Позвать друга» → видит, кто зовёт и когда,
// входит/регистрируется и записывается одним нажатием.
export default function Invite() {
  const { token } = useParams()
  return <InviteFor key={token} token={token} />
}

function InviteFor({ token }) {
  const { user, loading } = useAuth()
  const [info, setInfo] = useState(undefined) // undefined — грузим, null — не найдено
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (loading) return
    inviteInfo(token)
      .then(setInfo)
      .catch((e) => {
        setError(e.message)
        setInfo(null)
      })
  }, [token, loading, user])

  const accept = async () => {
    setBusy(true)
    setError('')
    try {
      await acceptInvite(token)
      setDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading || info === undefined) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" />
      </div>
    )
  }

  if (!info) {
    return (
      <div className="mx-auto max-w-sm py-12 text-center">
        <h1 className="text-2xl">{t('Приглашение не найдено')}</h1>
        <p className="mt-3 text-neutral-400">{error || t('Ссылка устарела или скопирована не полностью.')}</p>
        <Link to="/" className="btn-outline mt-6 inline-block">{t('На главную')}</Link>
      </div>
    )
  }

  const next = encodeURIComponent(`/invite/${token}`)
  const over = new Date(info.starts_at) <= new Date()
  const closed = info.cancelled || over
  const full = isFull(info) && !info.is_booked

  return (
    <div className="mx-auto max-w-md space-y-5 py-6">
      <div className="text-center">
        <p className="label">{t('Приглашение')}</p>
        <h1 className="text-3xl">{t('{name} зовёт вас на тренировку', { name: info.inviter_name })}</h1>
      </div>

      <div className="card space-y-1">
        <p className="font-display text-xl uppercase tracking-wide">
          {sessionDay(info.starts_at)} · {sessionTime(info)}
        </p>
        <p className="text-neutral-300">{tData(info.title)}</p>
        <p className="text-sm text-neutral-400">📍 {info.venue_name}{info.venue_address && `, ${info.venue_address}`}</p>
        <p className={`text-xs ${full ? 'text-accent' : 'text-neutral-500'}`}>{seatsText(info)}</p>
        <p className="pt-2 text-sm font-semibold text-accent">{t('Первая тренировка — бесплатно.')}</p>
      </div>

      {error && <p className="rounded-md border border-accent p-3 text-sm text-accent">{error}</p>}

      {closed ? (
        <p className="card text-center text-neutral-400">
          {info.cancelled ? t('Это занятие отменено.') : t('Эта тренировка уже прошла.')} {t('Посмотрите расписание в приложении.')}
        </p>
      ) : done || info.is_booked ? (
        <div className="card space-y-3 text-center">
          <p className="text-2xl">{t('✓ Вы записаны!')}</p>
          <p className="text-sm text-neutral-400">{t('Возьмите спортивную форму и воду. До встречи на тренировке.')}</p>
          <Link to="/dashboard" className="btn-outline inline-block">{t('В кабинет')}</Link>
        </div>
      ) : info.is_mine ? (
        <p className="card text-center text-neutral-400">{t('Это ваше приглашение — отправьте ссылку другу.')}</p>
      ) : !user ? (
        <div className="space-y-2">
          <Link to={`/register?next=${next}`} className="btn-primary block w-full text-center">
            {t('Зарегистрироваться и записаться')}
          </Link>
          <Link to={`/login?next=${next}`} className="btn-outline block w-full text-center">
            {t('Уже есть аккаунт — войти')}
          </Link>
        </div>
      ) : (
        <button type="button" onClick={accept} disabled={busy || full} className="btn-primary w-full disabled:opacity-60">
          {busy ? t('Записываем…') : full ? t('Мест нет') : t('Записаться')}
        </button>
      )}
    </div>
  )
}

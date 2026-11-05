import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { checkIn } from '../lib/club-ops.js'

// Ученик сканирует QR на экране тренера обычной камерой телефона →
// открывается эта страница → посещение засчитывается само.
// key={token}: новый QR-код — новая попытка (иначе React переиспользует состояние).
export default function Checkin() {
  const { token } = useParams()
  return <CheckinFor key={token} token={token} />
}

function CheckinFor({ token }) {
  const { user, loading, refreshProfile } = useAuth()
  const [state, setState] = useState({ status: 'idle' })
  const sent = useRef(false)

  useEffect(() => {
    if (loading || !user || sent.current) return
    sent.current = true
    setState({ status: 'pending' })
    checkIn(token)
      .then((r) => {
        setState({ status: 'ok', ...r })
        refreshProfile()
      })
      .catch((e) => setState({ status: 'error', message: e.message }))
  }, [loading, user, token, refreshProfile])

  if (loading || state.status === 'pending' || (user && state.status === 'idle')) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" />
        <p className="mt-4 text-sm text-neutral-400">Отмечаем тренировку…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-sm py-12 text-center">
        <h1 className="text-3xl">Отметка на тренировке</h1>
        <p className="mt-3 text-neutral-400">Войдите в приложение — и тренировка засчитается автоматически.</p>
        <Link to={`/login?next=${encodeURIComponent(`/checkin/${token}`)}`} className="btn-primary mt-6 inline-block">
          Войти
        </Link>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-sm py-12 text-center">
        <p className="text-5xl">⚠️</p>
        <h1 className="mt-4 text-2xl">Не получилось отметиться</h1>
        <p className="mt-3 text-neutral-400">{state.message}</p>
        <Link to="/dashboard" className="btn-outline mt-6 inline-block">В кабинет</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm py-12 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-accent text-4xl font-bold">✓</div>
      <h1 className="mt-6 text-3xl">{state.already ? 'Вы уже отмечены' : 'Тренировка засчитана!'}</h1>
      <p className="mt-2 text-neutral-400">{state.session_title}</p>
      <p className="mt-6 font-display text-5xl">{state.trainings}</p>
      <p className="text-xs uppercase tracking-wider text-neutral-500">тренировок всего</p>
      <Link to="/dashboard" className="btn-outline mt-8 inline-block">В кабинет</Link>
    </div>
  )
}

import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { signInWithPhone } from '../lib/auth.js'
import { supabase } from '../lib/supabaseClient.js'
import { SECTIONS, getKids, getSection, setKids, setSection } from '../lib/section.js'

// Вход: выбор раздела — Grappling, MMA / K1, MMA дети или «Тренер» (отдельный вход для тренера и помощника).
const MODES = [...Object.entries(SECTIONS), ['mma_kids', 'MMA дети'], ['coach', 'Тренер']]
const LABELS = Object.fromEntries(MODES)

export default function Login() {
  const navigate = useNavigate()
  // ?next=/checkin/… — вернуть туда, откуда пришли (только внутренние пути).
  const [params] = useSearchParams()
  const nextParam = params.get('next')?.startsWith('/') ? params.get('next') : null
  const [mode, setMode] = useState(() => (getKids() ? 'mma_kids' : getSection() ?? 'grappling'))
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const coach = mode === 'coach'

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await signInWithPhone(phone, password)
      if (coach) {
        const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
        if (!['admin', 'coach'].includes(data?.role)) {
          await supabase.auth.signOut()
          throw new Error('Этот вход — только для тренеров. Выберите Grappling или MMA / K1.')
        }
        navigate(nextParam ?? '/admin', { replace: true })
      } else {
        // MMA дети — то же направление MMA, но только детские занятия
        setSection(mode === 'mma_kids' ? 'mma' : mode)
        setKids(mode === 'mma_kids')
        navigate(nextParam ?? '/dashboard', { replace: true })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-3xl">Вход</h1>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="Куда входим">
        {MODES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`rounded-md border px-1 py-3 font-display text-sm uppercase tracking-wider ${
              mode === id ? 'border-accent bg-accent/10 text-white' : 'border-line text-neutral-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-center text-xs text-neutral-500">
        {coach
          ? 'Вход для тренеров — сразу в панель тренера.'
          : mode === 'grappling'
            ? 'Daugavpils Grappling Team'
            : mode === 'mma_kids'
              ? 'Детское MMA · Вт и Чт 16:30–17:45. Ребёнок входит по логину от родителя (например 27167013-1).'
              : 'Daugavpils Top Team — MMA и K1'}
      </p>

      <form className="card space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="label" htmlFor="phone">
            {mode === 'mma_kids' ? 'Телефон или логин ребёнка' : 'Номер телефона'}
          </label>
          {/* Ребёнок входит по логину «телефон родителя-номер», например 27167013-1 (слой 24) */}
          <input
            id="phone"
            type="tel"
            className="input"
            required
            autoComplete="username"
            placeholder={mode === 'mma_kids' ? '2X XXX XXX-1' : '+371 2X XXX XXX'}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Пароль</label>
          <input
            id="password"
            type="password"
            className="input"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm font-semibold text-accent">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60">
          {loading ? 'Входим…' : coach ? 'Войти как тренер' : `Войти · ${LABELS[mode]}`}
        </button>
      </form>
      {!coach && (
        <p className="mt-4 text-center text-sm text-neutral-400">
          Нет аккаунта?{' '}
          <Link to="/register" className="text-accent hover:underline">Регистрация</Link>
        </p>
      )}
    </div>
  )
}

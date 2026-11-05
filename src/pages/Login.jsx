import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { signInWithPhone } from '../lib/auth.js'

export default function Login() {
  const navigate = useNavigate()
  // ?next=/checkin/… — вернуть туда, откуда пришли (только внутренние пути).
  const [params] = useSearchParams()
  const next = params.get('next')?.startsWith('/') ? params.get('next') : '/dashboard'
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signInWithPhone(phone, password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-3xl">Вход</h1>
      <form className="card space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="label" htmlFor="phone">Номер телефона</label>
          <input
            id="phone"
            type="tel"
            className="input"
            required
            autoComplete="tel"
            placeholder="+371 2X XXX XXX"
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
          {loading ? 'Входим…' : 'Войти'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-neutral-400">
        Нет аккаунта?{' '}
        <Link to="/register" className="text-accent hover:underline">Регистрация</Link>
      </p>
    </div>
  )
}

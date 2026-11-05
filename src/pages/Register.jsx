import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { registerAthlete } from '../lib/auth.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { DISCIPLINES, hasRanks } from '../lib/ranks.js'

// Регистрация (APP_PASSPORT §2): Имя, Фамилия, Телефон + обязательное селфи.
// Supabase: auth.signUp → триггер создаёт profiles → селфи в Storage (бакет avatars).
const EMPTY = { firstName: '', lastName: '', phone: '', password: '', discipline: 'grappling' }

export default function Register() {
  const [form, setForm] = useState(EMPTY)
  const [selfie, setSelfie] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef(null)
  const { refreshProfile } = useAuth()

  // Превью выбранного фото; освобождаем blob-URL при смене файла/уходе со страницы.
  useEffect(() => {
    if (!selfie) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(selfie)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [selfie])

  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Нужна фотография (изображение).')
      return
    }
    setError('')
    setSelfie(file)
  }

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!selfie) {
      setError('Сделайте селфи — тренеру нужно узнать вас на тренировке.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const user = await registerAthlete({ ...form, selfie })
      // Профиль мог загрузиться до того, как селфи записалось — перечитываем.
      await refreshProfile(user.id)
      setSubmitted(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-md text-center">
        <div className="card space-y-4">
          <img src={preview} alt="Ваше селфи" className="mx-auto h-28 w-28 rounded-full object-cover ring-4 ring-accent" />
          <h1 className="text-2xl">Добро пожаловать, {form.firstName}!</h1>
          <p className="text-neutral-400">
            Аккаунт создан.
            {hasRanks(form.discipline) && (
              <> Ваш ранг — <span className="text-accent">Юный падаван</span>.</>
            )}
          </p>
          <Link to="/dashboard" className="btn-primary">В кабинет</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-6 text-3xl">Регистрация</h1>
      <form className="card space-y-5" onSubmit={onSubmit}>
        {/* Селфи: превью над кнопкой */}
        <div className="flex flex-col items-center gap-3">
          <div
            className={`flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-ink ring-4 ${
              preview ? 'ring-accent' : 'ring-line'
            }`}
          >
            {preview ? (
              <img src={preview} alt="Предпросмотр селфи" className="h-full w-full object-cover" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-12 w-12 text-neutral-600" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" />
              </svg>
            )}
          </div>

          {/* capture="user" — на телефоне сразу открывает фронтальную камеру */}
          <input
            ref={fileRef}
            id="selfie"
            type="file"
            accept="image/*"
            capture="user"
            className="sr-only"
            onChange={onFile}
          />
          <label htmlFor="selfie" className={preview ? 'btn-outline cursor-pointer' : 'btn-primary cursor-pointer'}>
            {preview ? 'Переснять селфи' : 'Сделать селфи *'}
          </label>
          <p className="text-center text-xs text-neutral-500">
            Фото нужно тренеру, чтобы быстро узнать вас на тренировке
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="firstName">Имя *</label>
            <input id="firstName" name="firstName" value={form.firstName} onChange={onChange} className="input" required autoComplete="given-name" />
          </div>
          <div>
            <label className="label" htmlFor="lastName">Фамилия *</label>
            <input id="lastName" name="lastName" value={form.lastName} onChange={onChange} className="input" required autoComplete="family-name" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="phone">Номер телефона *</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            value={form.phone}
            onChange={onChange}
            className="input"
            required
            autoComplete="tel"
            pattern="\+?[0-9\s]{8,15}"
            placeholder="+371 2X XXX XXX"
          />
        </div>
        <fieldset>
          <legend className="label">Направление *</legend>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(DISCIPLINES).map(([value, label]) => (
              <label
                key={value}
                className={`cursor-pointer rounded-md border px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider transition-colors ${
                  form.discipline === value ? 'border-accent bg-accent/10 text-white' : 'border-line text-neutral-400 hover:border-white/40'
                }`}
              >
                <input
                  type="radio"
                  name="discipline"
                  value={value}
                  checked={form.discipline === value}
                  onChange={onChange}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="label" htmlFor="password">Пароль *</label>
          <input
            id="password"
            name="password"
            type="password"
            value={form.password}
            onChange={onChange}
            className="input"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="Минимум 6 символов"
          />
        </div>

        {error && <p className="text-sm font-semibold text-accent">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60">
          {loading ? 'Создаём аккаунт…' : 'Зарегистрироваться'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-neutral-400">
        Уже есть аккаунт?{' '}
        <Link to="/login" className="text-accent hover:underline">Войти</Link>
      </p>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { registerAthlete } from '../lib/auth.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { DISCIPLINES, hasRanks } from '../lib/ranks.js'
import { t } from '../lib/i18n.jsx'
import { friendlyError } from '../lib/offline.js'

// Регистрация (APP_PASSPORT §2): Имя, Фамилия, Телефон + обязательное селфи.
// Supabase: auth.signUp → триггер создаёт profiles → селфи в Storage (бакет avatars).
const EMPTY = { firstName: '', lastName: '', phone: '', password: '', password2: '', discipline: 'grappling' }

export default function Register() {
  const [form, setForm] = useState(EMPTY)
  const [selfie, setSelfie] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  // ?next=/invite/… — после регистрации вернуть туда (только внутренние пути).
  const [params] = useSearchParams()
  const next = params.get('next')?.startsWith('/') ? params.get('next') : null
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
    e.target.value = '' // чтобы повторный выбор того же файла снова сработал
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError(t('Нужна фотография (изображение).'))
      return
    }
    setError('')
    setSelfie(file)
  }

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!selfie) {
      setError(t('Добавьте фото — тренеру нужно узнать вас на тренировке.'))
      return
    }
    if (form.password !== form.password2) {
      setError(t('Пароли не совпадают — введите пароль ещё раз.'))
      return
    }
    setError('')
    setLoading(true)
    try {
      const { password2: _, ...data } = form
      const user = await registerAthlete({ ...data, selfie })
      // Профиль мог загрузиться до того, как селфи записалось — перечитываем.
      await refreshProfile(user.id)
      setSubmitted(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-md text-center">
        <div className="card space-y-4">
          <img src={preview} alt={t('Ваше селфи')} className="mx-auto h-28 w-28 rounded-full object-cover ring-4 ring-accent" />
          <h1 className="text-2xl">{t('Добро пожаловать, {name}!', { name: form.firstName })}</h1>
          <p className="text-neutral-400">
            {t('Аккаунт создан.')}
            {hasRanks(form.discipline) && (
              <> {t('Ваш ранг —')} <span className="text-accent">{t('Юный падаван')}</span>.</>
            )}
          </p>
          <Link to={next ?? '/dashboard'} className="btn-primary">{next ? t('Продолжить') : t('В кабинет')}</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-6 text-3xl">{t('Регистрация')}</h1>
      <form className="card space-y-5" onSubmit={onSubmit}>
        {/* Селфи: превью над кнопкой */}
        <div className="flex flex-col items-center gap-3">
          <div
            className={`flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-ink ring-4 ${
              preview ? 'ring-accent' : 'ring-line'
            }`}
          >
            {preview ? (
              <img src={preview} alt={t('Предпросмотр селфи')} className="h-full w-full object-cover" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-12 w-12 text-neutral-600" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" />
              </svg>
            )}
          </div>

          {/* Два способа добавить фото: камера (capture="user" — сразу фронтальная) или галерея (без capture).
              Работает в браузере, в установленной PWA и в Android-сборке Capacitor.
              Логика ниже не зависит от источника фото: onFile получает обычный File/Blob.
              TODO: Replace with @capacitor/camera for native build — Camera.getPhoto({ source: CameraSource.Prompt })
              только при Capacitor.isNativePlatform(), результат превращать в Blob и передавать в setSelfie. */}
          <input id="selfie" type="file" accept="image/*" capture="user" className="sr-only" onChange={onFile} />
          <input id="photo" type="file" accept="image/*" className="sr-only" onChange={onFile} />
          <div className="flex flex-wrap justify-center gap-2">
            <label htmlFor="selfie" className={preview ? 'btn-outline cursor-pointer' : 'btn-primary cursor-pointer'}>
              {preview ? t('Переснять') : t('Сделать селфи *')}
            </label>
            <label htmlFor="photo" className="btn-outline cursor-pointer">
              {t('Из галереи')}
            </label>
          </div>
          <p className="text-center text-xs text-neutral-500">
            {t('Фото нужно тренеру, чтобы быстро узнать вас на тренировке — лицо должно быть хорошо видно')}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="firstName">{t('Имя *')}</label>
            <input id="firstName" name="firstName" value={form.firstName} onChange={onChange} className="input" required autoComplete="given-name" />
          </div>
          <div>
            <label className="label" htmlFor="lastName">{t('Фамилия *')}</label>
            <input id="lastName" name="lastName" value={form.lastName} onChange={onChange} className="input" required autoComplete="family-name" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="phone">{t('Номер телефона *')}</label>
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
            placeholder="2X XXX XXX"
          />
          <p className="mt-1 text-xs text-neutral-500">{t('Код +371 можно не вводить — достаточно 8 цифр.')}</p>
        </div>
        <fieldset>
          <legend className="label">{t('Направление *')}</legend>
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
          <label className="label" htmlFor="password">{t('Пароль *')}</label>
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
            placeholder={t('Минимум 6 символов')}
          />
        </div>
        <div>
          <label className="label" htmlFor="password2">{t('Повторите пароль *')}</label>
          <input
            id="password2"
            name="password2"
            type="password"
            value={form.password2}
            onChange={onChange}
            className="input"
            required
            minLength={6}
            autoComplete="new-password"
            aria-invalid={form.password2 !== '' && form.password2 !== form.password}
          />
          {form.password2 !== '' && form.password2 !== form.password && (
            <p className="mt-1 text-xs text-accent">{t('Пароли не совпадают')}</p>
          )}
        </div>

        <p className="text-xs text-neutral-500">
          {t('Регистрируясь, вы соглашаетесь с')}{' '}
          <Link to="/privacy" className="text-accent hover:underline">{t('политикой конфиденциальности')}</Link>
          {' '}{t('(селфи, телефон, посещения). За ребёнка младше 13 лет регистрируется родитель.')}
        </p>
        {error && <p className="text-sm font-semibold text-accent">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60">
          {loading ? t('Создаём аккаунт…') : t('Зарегистрироваться')}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-neutral-400">
        {t('Уже есть аккаунт?')}{' '}
        <Link to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className="text-accent hover:underline">{t('Войти')}</Link>
      </p>
    </div>
  )
}

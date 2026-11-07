import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CLUB, TEAMS } from '../data/club.js'
import { TRIAL_DISCIPLINES, requestTrial } from '../lib/coach.js'
import { t } from '../lib/i18n.jsx'

// Публичная страница «Бесплатная пробная тренировка» (без входа).
// Сюда ведёт кнопка с сайта daugavpilstopteam.lv. Заявку видит только тренер (слой 34).
const EMPTY = { name: '', phone: '', discipline: 'mma', age: '', preferred: '', website: '' }

export default function Trial() {
  const [form, setForm] = useState(EMPTY)
  const [agree, setAgree] = useState(false)
  const [state, setState] = useState('form') // form | sending | done
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const wa = CLUB.coachPhone.replace(/\D/g, '')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.website) return setState('done') // поле-ловушка: заполняют только боты
    if (!agree) return setError(t('Отметьте согласие на обработку данных'))
    setState('sending')
    try {
      await requestTrial(form)
      setState('done')
    } catch (err) {
      setError(err.message)
      setState('form')
    }
  }

  if (state === 'done') {
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        <p className="text-5xl" aria-hidden="true">🥋</p>
        <h1 className="text-3xl">{t('Заявка отправлена!')}</h1>
        <p className="text-neutral-300">
          {t('Тренер {coach} свяжется с вами в WhatsApp или по телефону и договорится о времени.', { coach: CLUB.coach })}
        </p>
        <p className="text-sm text-neutral-400">
          {t('Хотите быстрее — напишите сами:')}{' '}
          <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener" className="text-accent hover:underline">
            {CLUB.coachPhone}
          </a>
        </p>
        <Link to="/" className="btn-outline">{t('На главную')}</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <header className="border-l-4 border-accent pl-4">
        <p className="label">{CLUB.name} · {CLUB.grapplingName}</p>
        <h1 className="text-3xl">{t('Первая тренировка — бесплатно')}</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {t('Оставьте заявку — тренер ответит и подскажет группу и время.')} {CLUB.address}.
        </p>
      </header>

      <form onSubmit={submit} className="card space-y-4">
        <div>
          <label className="label" htmlFor="t-name">{t('Имя')}</label>
          <input id="t-name" className="input" required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={set('name')} />
        </div>
        <div>
          <label className="label" htmlFor="t-phone">{t('Телефон (WhatsApp)')}</label>
          <input id="t-phone" className="input" required type="tel" inputMode="tel" autoComplete="tel" placeholder="+371 2X XXX XXX" value={form.phone} onChange={set('phone')} />
        </div>
        <div>
          <p className="label">{t('Направление')}</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(TRIAL_DISCIPLINES).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={form.discipline === id}
                onClick={() => setForm((f) => ({ ...f, discipline: id }))}
                className={`rounded-md border px-2 py-3 text-sm ${
                  form.discipline === id ? 'border-accent bg-accent/10 text-white' : 'border-line text-neutral-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="t-age">{t('Возраст')}</label>
            <input id="t-age" className="input" type="number" min={4} max={90} inputMode="numeric" value={form.age} onChange={set('age')} />
          </div>
          <div className="col-span-2">
            <label className="label" htmlFor="t-pref">{t('Когда удобно')}</label>
            <input id="t-pref" className="input" maxLength={200} placeholder={t('напр. по вечерам')} value={form.preferred} onChange={set('preferred')} />
          </div>
        </div>
        {/* Ловушка для ботов: люди это поле не видят */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={form.website} onChange={set('website')} />

        <label className="flex items-start gap-2 text-xs text-neutral-400">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            {t('Согласен(на), чтобы клуб хранил эти данные для связи со мной (до 180 дней).')}{' '}
            <Link to="/privacy" className="text-accent hover:underline">{t('Политика конфиденциальности')}</Link>
          </span>
        </label>

        {error && <p className="text-sm text-accent">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={state === 'sending'}>
          {state === 'sending' ? t('Отправляю…') : t('Записаться бесплатно')}
        </button>
      </form>

      <section className="space-y-2 text-sm">
        <p className="label">{t('Расписание')}</p>
        {TEAMS.map((t) => (
          <div key={t.id} className="card !p-3">
            <p className="font-semibold">{t.name} · {t.discipline}</p>
            <ul className="text-neutral-400">
              {t.classes.map((c, i) => (
                <li key={i}>{c.title}: {c.days.join(', ')} {c.time}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}

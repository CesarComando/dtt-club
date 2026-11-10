import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import { COACH_WHATSAPP, confirmReset, requestResetCode } from '../lib/password.js'

// «Забыли пароль?»: номер → SMS-код → новый пароль (слой 44).
// Пока SMS не подключены (sms_off) — предлагаем написать тренеру, он сбросит пароль.
export default function ResetPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState('phone') // phone | code | done | off
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await requestResetCode(phone)
      setStep('code')
    } catch (err) {
      if (err.code === 'sms_off') setStep('off')
      else setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (e) => {
    e.preventDefault()
    if (pw !== pw2) return setError(t('Пароли не совпадают'))
    setBusy(true)
    setError('')
    try {
      await confirmReset(phone, code, pw)
      setStep('done')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-6 py-6">
      <h1 className="text-4xl">{t('Новый пароль')}</h1>

      {step === 'phone' && (
        <form onSubmit={send} className="card space-y-4">
          <p className="text-sm text-neutral-300">{t('Введите номер, с которым регистрировались. Придёт SMS с кодом.')}</p>
          <div>
            <label className="label" htmlFor="rp-phone">{t('Номер телефона')}</label>
            <input id="rp-phone" type="tel" inputMode="tel" autoComplete="tel" required className="input" placeholder="20 000 000" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          {error && <p className="text-sm font-semibold text-accent">{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">{busy ? t('Отправляем…') : t('Получить код по SMS')}</button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={confirm} className="card space-y-4">
          <p className="text-sm text-neutral-300">{t('Если номер есть в клубе, на него пришло SMS с кодом. Код действует 10 минут.')}</p>
          <div>
            <label className="label" htmlFor="rp-code">{t('Код из SMS')}</label>
            <input id="rp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="input tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </div>
          <div>
            <label className="label" htmlFor="rp-pw">{t('Новый пароль')}</label>
            <PasswordInput id="rp-pw" required minLength={6} autoComplete="new-password" className="input" placeholder={t('мин. 6 символов')} value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="rp-pw2">{t('Повторите пароль')}</label>
            <PasswordInput id="rp-pw2" required minLength={6} autoComplete="new-password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
          {error && <p className="text-sm font-semibold text-accent">{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">{busy ? t('Сохраняем…') : t('Сохранить пароль')}</button>
          <button type="button" onClick={() => { setStep('phone'); setCode(''); setError('') }} className="w-full text-sm text-neutral-400 hover:underline">
            {t('SMS не пришло — отправить ещё раз')}
          </button>
        </form>
      )}

      {step === 'done' && (
        <div className="card space-y-4 text-center">
          <p className="text-4xl">✓</p>
          <p>{t('Пароль изменён. Войдите с новым паролем.')}</p>
          <button type="button" onClick={() => navigate('/login', { replace: true })} className="btn-primary w-full">{t('Войти')}</button>
        </div>
      )}

      {step === 'off' && (
        <div className="card space-y-4">
          <p>{t('Восстановление по SMS пока не подключено. Напишите тренеру — он за минуту поставит временный пароль.')}</p>
          <a href={COACH_WHATSAPP} target="_blank" rel="noreferrer" className="btn-primary block w-full text-center">{t('Написать тренеру в WhatsApp')}</a>
        </div>
      )}

      <p className="text-center text-sm text-neutral-400">
        <Link to="/login" className="hover:underline">{t('← Назад ко входу')}</Link>
      </p>
    </div>
  )
}

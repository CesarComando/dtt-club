import { useState } from 'react'
import { t } from '../lib/i18n.jsx'

// Поле пароля с «глазом»: нажал — пароль виден, нажал ещё раз — снова точки.
// Все остальные свойства (id, value, onChange, required…) уходят в <input> как есть.
const EYE = 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
const EYE_OFF = 'M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2'

export default function PasswordInput({ className = 'input', ...props }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input {...props} type={shown ? 'text' : 'password'} className={`${className} pr-12`} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t('Скрыть пароль') : t('Показать пароль')}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-neutral-400 hover:text-white"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={shown ? EYE_OFF : EYE} />
        </svg>
      </button>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.jsx'

// Плашка «Установить приложение» (PWA). Браузеры сами почти не предлагают
// установку, а на iPhone такого предложения нет вовсе — подсказываем:
//   • Android / Chrome / Edge — системное окно установки по кнопке;
//   • iPhone / iPad (Safari) — «Поделиться → На экран „Домой“»;
//   • встроенный браузер Instagram / Facebook / WhatsApp — открыть в обычном браузере.
// Не показываем, если приложение уже открыто как установленное, или плашку закрыли.

const DISMISS_KEY = 'dtt-install-dismissed'

// Событие может прийти раньше, чем React смонтирует плашку, — ловим его сразу.
let deferredPrompt = null
const listeners = new Set()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    listeners.forEach((fn) => fn(e))
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    listeners.forEach((fn) => fn(null))
  })
}

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
const inApp = /Instagram|FBAN|FBAV|FB_IAB|WhatsApp|Line\/|Telegram/i.test(ua)
const isMobile = isIOS || /Android/i.test(ua)
const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export default function InstallApp() {
  const [prompt, setPrompt] = useState(deferredPrompt)
  const [hidden, setHidden] = useState(() => standalone() || readDismissed())
  const [help, setHelp] = useState(false)

  useEffect(() => {
    listeners.add(setPrompt)
    return () => listeners.delete(setPrompt)
  }, [])

  // Показываем на телефонах, а на компьютере — только если браузер готов установить.
  if (hidden || (!isMobile && !prompt)) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* приватный режим — просто скрываем до перезагрузки */
    }
    setHidden(true)
  }

  const install = async () => {
    if (prompt) {
      prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') setHidden(true)
      deferredPrompt = null
      setPrompt(null)
    } else {
      setHelp((h) => !h)
    }
  }

  return (
    <div className="mb-5 rounded-lg border border-accent/60 bg-accent/10 p-4">
      <div className="flex items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}pwa-192x192.png`} alt="" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-display uppercase tracking-wide">{t('Приложение клуба на телефон')}</p>
          <p className="text-xs text-neutral-300">{t('Иконка на экране, открывается как обычное приложение.')}</p>
        </div>
        <button type="button" onClick={dismiss} aria-label={t('Скрыть')} className="self-start px-1 text-neutral-500 hover:text-white">
          ✕
        </button>
      </div>

      <button type="button" onClick={install} className="btn-primary mt-3 w-full">
        {t('Установить приложение')}
      </button>

      {help && (
        <div className="mt-3 space-y-1 text-sm text-neutral-200">
          {inApp ? (
            <>
              <p>{t('Вы открыли сайт внутри Instagram / WhatsApp — оттуда установить нельзя.')}</p>
              <p>
                {t('Нажмите')} <b>⋯</b> {t('вверху справа →')} <b>{t('«Открыть в браузере»')}</b> ({isIOS ? 'Safari' : 'Chrome'}),{' '}
                {t('и там снова «Установить приложение».')}
              </p>
            </>
          ) : isIOS ? (
            <ol className="list-decimal space-y-1 pl-5">
              <li>{t('Откройте сайт в')} <b>Safari</b>.</li>
              <li>{t('Нажмите кнопку')} <b>{t('«Поделиться»')}</b> {t('(квадрат со стрелкой вверх) внизу экрана.')}</li>
              <li>{t('Выберите')} <b>{t('«На экран „Домой“»')}</b> → <b>{t('«Добавить»')}</b>.</li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-1 pl-5">
              <li>{t('Откройте сайт в')} <b>Chrome</b>.</li>
              <li>{t('Нажмите')} <b>⋮</b> {t('вверху справа.')}</li>
              <li>{t('Выберите')} <b>{t('«Установить приложение»')}</b> {t('или')} <b>{t('«Добавить на главный экран»')}</b>.</li>
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

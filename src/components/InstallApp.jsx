import { useEffect, useState } from 'react'

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
          <p className="font-display uppercase tracking-wide">Приложение клуба на телефон</p>
          <p className="text-xs text-neutral-300">Иконка на экране, открывается как обычное приложение.</p>
        </div>
        <button type="button" onClick={dismiss} aria-label="Скрыть" className="self-start px-1 text-neutral-500 hover:text-white">
          ✕
        </button>
      </div>

      <button type="button" onClick={install} className="btn-primary mt-3 w-full">
        Установить приложение
      </button>

      {help && (
        <div className="mt-3 space-y-1 text-sm text-neutral-200">
          {inApp ? (
            <>
              <p>Вы открыли сайт внутри Instagram / WhatsApp — оттуда установить нельзя.</p>
              <p>
                Нажмите <b>⋯</b> вверху справа → <b>«Открыть в браузере»</b> ({isIOS ? 'Safari' : 'Chrome'}), и там снова
                «Установить приложение».
              </p>
            </>
          ) : isIOS ? (
            <ol className="list-decimal space-y-1 pl-5">
              <li>Откройте сайт в <b>Safari</b>.</li>
              <li>Нажмите кнопку <b>«Поделиться»</b> (квадрат со стрелкой вверх) внизу экрана.</li>
              <li>Выберите <b>«На экран „Домой“»</b> → <b>«Добавить»</b>.</li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-1 pl-5">
              <li>Откройте сайт в <b>Chrome</b>.</li>
              <li>Нажмите <b>⋮</b> вверху справа.</li>
              <li>Выберите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.</li>
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

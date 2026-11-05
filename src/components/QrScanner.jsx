import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Сканер QR внутри приложения: открывает заднюю камеру и ищет QR-код отметки.
// Встроенный BarcodeDetector (Chrome/Android) — быстрее; где его нет (iPhone, Firefox) — jsQR.
// Код тренера кодирует ссылку …#/checkin/<token> — открываем её внутри приложения.
// Обычная камера телефона тоже работает (это просто ссылка) — кнопка лишь удобнее.

/** Токен из текста QR (ссылка на чекин клуба) или null. */
export const tokenFromQr = (text) => String(text ?? '').match(/#\/checkin\/([A-Za-z0-9_-]+)/)?.[1] ?? null

export default function QrScanner({ onClose }) {
  const videoRef = useRef(null)
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [wrong, setWrong] = useState(false)

  useEffect(() => {
    let stream
    let raf
    let stopped = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const found = (text) => {
      const token = tokenFromQr(text)
      if (!token) {
        setWrong(true)
        return false
      }
      stopped = true
      navigator.vibrate?.(80)
      onClose()
      navigate(`/checkin/${token}`)
      return true
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Этот браузер не даёт доступ к камере. Отсканируйте QR обычной камерой телефона.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
      } catch (e) {
        setError(
          e?.name === 'NotAllowedError'
            ? 'Нет доступа к камере. Разрешите камеру для этого сайта в настройках браузера — или отсканируйте QR обычной камерой телефона.'
            : 'Не удалось включить камеру. Отсканируйте QR обычной камерой телефона.',
        )
        return
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop())
      const video = videoRef.current
      video.srcObject = stream
      await video.play().catch(() => {})

      const detector =
        'BarcodeDetector' in window
          ? await window.BarcodeDetector.getSupportedFormats?.()
              .then((f) => (f.includes('qr_code') ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null))
              .catch(() => null)
          : null
      const jsQR = detector ? null : (await import('jsqr')).default

      let last = 0
      const tick = async (t) => {
        if (stopped) return
        // ~6 кадров в секунду хватает и не сажает батарею
        if (t - last > 160 && video.readyState >= 2) {
          last = t
          try {
            if (detector) {
              const codes = await detector.detect(video)
              if (codes[0] && found(codes[0].rawValue)) return
            } else {
              const w = Math.min(640, video.videoWidth)
              const h = Math.round((video.videoHeight / video.videoWidth) * w) || w
              canvas.width = w
              canvas.height = h
              ctx.drawImage(video, 0, 0, w, h)
              const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })
              if (code && found(code.data)) return
            }
          } catch {
            /* кадр не прочитался — пробуем следующий */
          }
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [navigate, onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Сканер QR-кода">
      <div className="flex items-center justify-between p-4">
        <p className="font-display text-lg uppercase tracking-wider">Отметиться по QR</p>
        <button type="button" onClick={onClose} className="btn-outline !px-4 !py-2">Закрыть</button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[min(70vw,50vh)] w-[min(70vw,50vh)] rounded-2xl border-4 border-accent/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="card max-w-sm text-center text-sm">{error}</p>
          </div>
        )}
      </div>
      <p className="p-4 pb-8 text-center text-sm text-neutral-300">
        {wrong ? 'Это не QR-код клуба. Наведите камеру на код на экране тренера.' : 'Наведите камеру на QR-код на экране тренера у входа.'}
      </p>
    </div>
  )
}

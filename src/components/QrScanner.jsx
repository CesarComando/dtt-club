import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
// jsQR входит в тот же файл, что и сканер (а сам сканер грузится, только когда его открыли).
// Раньше он догружался отдельно уже после включения камеры — при плохой связи загрузка
// падала, камера оставалась включённой, а «Повторить» не помогало: браузер запоминает
// неудачную загрузку модуля до перезагрузки страницы.
import jsQRLib from 'jsqr'
import { t } from '../lib/i18n.jsx'

// Сканер QR внутри приложения: открывает заднюю камеру и ищет QR-код отметки.
// Встроенный BarcodeDetector (Chrome/Android) — быстрее; где его нет (iPhone, Firefox) — jsQR.
// Код тренера кодирует ссылку …#/checkin/<token>, плакат на стене — …#/zal/<группа>; открываем внутри приложения.
// Обычная камера телефона тоже работает (это просто ссылка) — кнопка лишь удобнее.

/** Токен из текста QR (ссылка на чекин клуба) или null. */
export const tokenFromQr = (text) => String(text ?? '').match(/#\/checkin\/([A-Za-z0-9_-]+)/)?.[1] ?? null

/** Путь внутри приложения из QR клуба: код тренера (#/checkin/…) или постоянный QR на стене зала (#/zal/…). */
export const pathFromQr = (text) => {
  const token = tokenFromQr(text)
  if (token) return `/checkin/${token}`
  const group = String(text ?? '').match(/#\/zal\/([A-Za-z0-9_-]+)/)?.[1]
  return group ? `/zal/${group}` : null
}

/** Распознаватель QR: встроенный BarcodeDetector (быстрее) или jsQR. */
async function makeReader() {
  const detector =
    'BarcodeDetector' in window
      ? await window.BarcodeDetector.getSupportedFormats?.()
          .then((f) => (f.includes('qr_code') ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null))
          .catch(() => null)
      : null
  if (detector) return { detector }
  return { jsQR: jsQRLib }
}

/** Прочитать QR из картинки/кадра (img, bitmap или video). */
async function readCode(reader, source, width, height, canvas, ctx, inversion = 'dontInvert') {
  if (reader.detector) return (await reader.detector.detect(source))[0]?.rawValue ?? null
  const w = Math.min(640, width)
  const h = Math.round((height / width) * w) || w
  canvas.width = w
  canvas.height = h
  ctx.drawImage(source, 0, 0, w, h)
  return reader.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: inversion })?.data ?? null
}

const newCanvas = () => {
  const canvas = document.createElement('canvas')
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) }
}

export default function QrScanner({ onClose }) {
  const videoRef = useRef(null)
  const photoRef = useRef(null)
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [wrong, setWrong] = useState(false)
  const [attempt, setAttempt] = useState(0) // «Повторить» — запустить камеру заново
  const [photoBusy, setPhotoBusy] = useState(false)

  const go = useCallback(
    (text) => {
      const path = pathFromQr(text)
      if (!path) {
        setWrong(true)
        return false
      }
      navigator.vibrate?.(80)
      onClose()
      navigate(path)
      return true
    },
    [navigate, onClose],
  )

  // Запасной путь: снимок обычной камерой телефона (или фото из галереи) — читаем QR с него.
  const onPhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    setWrong(false)
    try {
      const reader = await makeReader()
      const bitmap = await createImageBitmap(file)
      const { canvas, ctx } = newCanvas()
      const text = await readCode(reader, bitmap, bitmap.width, bitmap.height, canvas, ctx, 'attemptBoth')
      bitmap.close?.()
      if (!text) setError(t('На снимке не нашёлся QR-код. Снимите код крупнее и ровнее — или откройте приложение «Камера» и наведите его на QR: ссылка откроется сама.'))
      else if (go(text)) return
    } catch {
      setError(t('Не получилось прочитать снимок. Откройте приложение «Камера» и наведите его на QR — ссылка откроется сама.'))
    } finally {
      setPhotoBusy(false)
    }
  }

  useEffect(() => {
    let stream
    let raf
    let stopped = false
    const { canvas, ctx } = newCanvas()
    setError('')
    setWrong(false)

    const stopCamera = () => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((tr) => tr.stop())
      stream = null
      if (videoRef.current) videoRef.current.srcObject = null
    }

    const found = (text) => {
      if (!pathFromQr(text)) return go(text)
      stopped = true
      stopCamera()
      return go(text)
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t('Этот браузер не даёт доступ к камере. Отсканируйте QR обычной камерой телефона.'))
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
            ? t('Нет доступа к камере. Разрешите камеру для этого сайта в настройках браузера — или отсканируйте QR обычной камерой телефона.')
            : t('Не удалось включить камеру. Отсканируйте QR обычной камерой телефона.'),
        )
        return
      }
      if (stopped) return stopCamera()
      // Камера уже включена. Если дальше что-то сломается (например, при плохой связи
      // не загрузился модуль распознавания), камеру выключаем и показываем кнопки.
      try {
        const video = videoRef.current
        video.srcObject = stream
        await video.play().catch(() => {})
        const reader = await makeReader()
        if (stopped) return

        let last = 0
        const tick = async (ts) => {
          if (stopped) return
          // ~6 кадров в секунду хватает и не сажает батарею
          if (ts - last > 160 && video.readyState >= 2) {
            last = ts
            try {
              const text = await readCode(reader, video, video.videoWidth, video.videoHeight, canvas, ctx)
              if (text && found(text)) return
            } catch {
              /* кадр не прочитался — пробуем следующий */
            }
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch {
        stopCamera()
        if (!stopped) setError(t('Сканер не запустился. Нажмите «Повторить» или откройте обычную камеру.'))
      }
    }

    start()
    return () => {
      stopped = true
      stopCamera()
    }
  }, [go, attempt])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={t('Сканер QR-кода')}>
      <div className="flex items-center justify-between p-4">
        <p className="font-display text-lg uppercase tracking-wider">{t('Отметиться по QR')}</p>
        <button type="button" onClick={onClose} className="btn-outline !px-4 !py-2">{t('Закрыть')}</button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <input ref={photoRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} tabIndex={-1} aria-hidden="true" />
        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[min(70vw,50vh)] w-[min(70vw,50vh)] rounded-2xl border-4 border-accent/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="card max-w-sm space-y-3 text-center text-sm">
              <p>{error}</p>
              <div className="flex flex-col gap-2">
                <button type="button" onClick={() => setAttempt((n) => n + 1)} className="btn-primary">{t('Повторить')}</button>
                <button type="button" onClick={() => photoRef.current?.click()} disabled={photoBusy} className="btn-outline disabled:opacity-60">
                  {photoBusy ? t('Читаем снимок…') : t('Открыть обычной камерой')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="p-4 pb-8 text-center text-sm text-neutral-300">
        {wrong ? t('Это не QR-код клуба. Наведите камеру на код на экране тренера.') : t('Наведите камеру на QR-код на экране тренера у входа.')}
      </p>
    </div>
  )
}

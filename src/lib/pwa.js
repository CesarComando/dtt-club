// Обновление установленного приложения (PWA) после выкладки.
// Раньше новая версия подхватывалась только со второго открытия: первое открытие
// показывало старую из кэша. Теперь: сразу при открытии и при возврате в приложение
// проверяем, нет ли новой версии; если есть — сервис-воркер ставит её и страница
// перезагружается сама (registerType: 'autoUpdate' в vite.config.js).
import { registerSW } from 'virtual:pwa-register'

const CHECK_EVERY_MS = 30 * 60 * 1000 // и раз в полчаса, если приложение долго открыто

export function startPwaUpdates() {
  if (!('serviceWorker' in navigator)) return
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine) registration.update().catch(() => {})
      }
      setInterval(check, CHECK_EVERY_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })
}

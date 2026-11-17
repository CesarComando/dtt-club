import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.jsx'

// Игры для ума из GRAPPLING WORLD: шахматы, шашки, судоку, реакция.
// Сами игры — готовая страница public/games/index.html (свой код и стили, ничего не берёт из базы);
// здесь она встроена рамкой. Рамка сама растёт по высоте игры (игра присылает высоту),
// поэтому прокручивается вся страница приложения, а не рамка внутри неё.
// Рекорды и привычки компьютера хранятся в этом браузере (localStorage, ключи gw-*).
export default function Games() {
  const frame = useRef(null)
  const [height, setHeight] = useState(null)

  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== frame.current?.contentWindow) return
      const h = Number(e.data?.dttGamesHeight)
      if (h > 0) setHeight(h)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl">{t('Игры для ума')}</h1>
        <p className="mt-1 text-sm text-neutral-400">{t('Шахматы, шашки, судоку и игры на реакцию')}</p>
      </div>
      <iframe
        ref={frame}
        src={`${import.meta.env.BASE_URL}games/index.html`}
        title={t('Игры для ума')}
        className="block w-full border-0"
        style={{ height: height ? `${height}px` : '80dvh' }}
      />
    </div>
  )
}

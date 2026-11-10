import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { t } from '../lib/i18n.jsx'

// Знакомство с приложением: короткие шаги внизу экрана, приложение переходит
// на нужную страницу, чтобы было видно, о чём речь.
// • Новому пользователю один раз предлагаем «Пройти» / «Нет, разберусь сам» — отказ запоминаем.
// • Пройти заново: Кабинет → «Как пользоваться приложением» (openTour()).
// Отметка «уже показывали» — в localStorage, отдельно для каждого аккаунта.

const KEY = (uid) => `dtt-tour-done:${uid}`
const OPEN_EVENT = 'dtt-tour-open'

/** Запустить знакомство с первого шага (кнопка в Кабинете). */
export const openTour = () => window.dispatchEvent(new Event(OPEN_EVENT))

const readDone = (uid) => {
  try {
    return localStorage.getItem(KEY(uid)) === '1'
  } catch {
    return true // хранилище недоступно — не навязываем
  }
}
const markDone = (uid) => {
  try {
    localStorage.setItem(KEY(uid), '1')
  } catch {
    /* ничего */
  }
}

function steps({ staff, admin, athlete }) {
  return [
    {
      to: '/dashboard',
      icon: '👋',
      title: t('Добро пожаловать в клуб!'),
      text: t('Здесь запись на тренировки, оплата, отметка в зале, дневник, оценки и магазин клуба. Пройдём по главному — это меньше минуты.'),
    },
    {
      to: '/dashboard',
      icon: '👤',
      title: t('Кабинет'),
      text: t('Ваш профиль, ранг и стаж. Здесь же видно, до какого числа действует абонемент. Если вы родитель — здесь и данные ребёнка.'),
    },
    {
      to: '/dashboard',
      icon: '📅',
      title: t('Запись на тренировку'),
      text: t('В Кабинете блок «Запись на тренировки»: нажмите «Записаться» у нужного дня. Передумали — там же «Отменить».'),
    },
    athlete && {
      to: '/dashboard',
      icon: '📷',
      title: t('Отметка в зале'),
      text: t('Пришли на тренировку — нажмите красную кнопку QR внизу и наведите камеру на код у тренера. Или в Кабинете «Я на тренировке — отметиться» (раз в день, до 3 часов после тренировки). Тренировка засчитается в ваш ранг.'),
    },
    {
      to: '/dashboard',
      icon: '💳',
      title: t('Оплата'),
      text: t('В Кабинете блок «Оплата»: абонемент или разовая тренировка картой. Платите переводом на счёт — тренер внесёт оплату сам, и вы увидите, до какого числа абонемент.'),
    },
    {
      to: '/diary',
      icon: '📓',
      title: t('Дневник и оценки'),
      text: t('После тренировки запишите, что отработали, и отметьте освоенные приёмы. Во вкладке «Оценки» — оценки партнёров 1–10 и рейтинг клуба.'),
    },
    {
      to: '/gallery',
      icon: '🖼️',
      title: t('Галерея'),
      text: t('Фото и видео клуба. Можно загрузить своё — оно появится после одобрения тренером.'),
    },
    {
      to: '/articles',
      icon: '📰',
      title: t('Статьи'),
      text: t('Новости клуба, результаты турниров и полезные материалы от тренера.'),
    },
    {
      to: '/shop',
      icon: '👕',
      title: t('Магазин'),
      text: t('Форма GERA с дизайнами клуба: выберите дизайн, вещь и размер, под размером — мерки. Шьют под заказ, забираете на тренировке.'),
    },
    staff && {
      to: '/admin',
      icon: '🧑‍🏫',
      title: t('Тренер'),
      text: admin
        ? t('Панель тренера: ученики и оплаты, кто уже в приложении, расписание, магазин, бюджет.')
        : t('Панель тренера: отметка учеников в зале и абонементы учеников MMA / K1 — до какого числа оплачено.'),
    },
    {
      to: '/dashboard',
      icon: '💬',
      title: t('Есть вопрос?'),
      text: t('Красная круглая кнопка с облачком справа внизу — «Спросить»: помощник клуба ответит про расписание, цены и правила. Пройти знакомство заново: Кабинет → «Как пользоваться приложением».'),
    },
  ].filter(Boolean)
}

export default function Tour() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [mode, setMode] = useState(null) // null | 'offer' | 'tour'
  const [i, setI] = useState(0)

  const staff = ['admin', 'coach'].includes(profile?.role)
  const admin = profile?.role === 'admin'
  const list = useMemo(() => steps({ staff, admin, athlete: Boolean(profile) && !staff }), [staff, admin, profile])
  const uid = user?.id

  // Предложить один раз — когда профиль загрузился и человек не на входе/регистрации.
  useEffect(() => {
    if (!uid || !profile || mode) return
    if (['/login', '/register'].includes(pathname)) return
    if (readDone(uid)) return
    const id = setTimeout(() => setMode('offer'), 1200)
    return () => clearTimeout(id)
  }, [uid, profile, pathname, mode])

  const start = useCallback(() => {
    setI(0)
    setMode('tour')
    navigate(list[0].to)
  }, [list, navigate])

  useEffect(() => {
    window.addEventListener(OPEN_EVENT, start)
    return () => window.removeEventListener(OPEN_EVENT, start)
  }, [start])

  const close = () => {
    if (uid) markDone(uid)
    setMode(null)
  }
  const go = (n) => {
    if (n >= list.length) return close()
    setI(n)
    navigate(list[n].to)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!uid || !mode) return null

  const box =
    'fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-md rounded-xl border border-accent/60 bg-panel p-4 shadow-2xl shadow-black/60 md:bottom-6'

  if (mode === 'offer') {
    return (
      <div className={box} role="dialog" aria-label={t('Знакомство с приложением')}>
        <p className="font-display text-lg uppercase tracking-wide">{t('Впервые в приложении?')}</p>
        <p className="mt-1 text-sm text-neutral-300">
          {t('Покажем за минуту, где запись, оплата, QR-отметка и всё остальное.')}
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={start} className="btn-primary flex-1">
            {t('Пройти')}
          </button>
          <button type="button" onClick={close} className="btn-outline flex-1">
            {t('Нет, разберусь сам')}
          </button>
        </div>
      </div>
    )
  }

  const s = list[i]
  const last = i === list.length - 1
  return (
    <div className={box} role="dialog" aria-label={t('Знакомство с приложением')}>
      <div className="flex items-start gap-3">
        <span className="text-3xl leading-none" aria-hidden="true">{s.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg uppercase tracking-wide">{s.title}</p>
          <p className="mt-1 text-sm text-neutral-300">{s.text}</p>
        </div>
        <button type="button" onClick={close} aria-label={t('Закрыть')} className="-mr-1 -mt-1 px-1 text-xl leading-none text-neutral-500 hover:text-white">
          ×
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-label={t('Шаг {n} из {k}', { n: i + 1, k: list.length })}>
          {list.map((_, n) => (
            <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= i ? 'bg-accent' : 'bg-line'}`} />
          ))}
        </div>
        {i > 0 && (
          <button type="button" onClick={() => go(i - 1)} className="btn-outline !px-3 !py-1.5 text-sm">
            {t('Назад')}
          </button>
        )}
        <button type="button" onClick={() => go(i + 1)} className="btn-primary !px-4 !py-1.5 text-sm">
          {last ? t('Готово') : t('Дальше')}
        </button>
      </div>
    </div>
  )
}

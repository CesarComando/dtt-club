import { lazy, Suspense, useCallback, useState } from 'react'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'

// Сканер с камерой грузится только по нажатию кнопки QR в таб-баре.
const QrScanner = lazy(() => import('./QrScanner.jsx'))
const QR_ICON = 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10'

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

const ICONS = {
  home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  schedule: 'M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  profile: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  diary: 'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM18 20a2 2 0 0 0 2-2V7M8 8h6M8 12h6',
  gallery: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  login: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  coach: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  logout:'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
}

// Админка намеренно не в списке — панель тренера скрыта.
const LINKS = [
  { to: '/', label: 'Главная', icon: 'home', end: true },
  { to: '/dashboard', label: 'Кабинет', icon: 'profile' },
  { to: '/login', label: 'Вход', icon: 'login' },
]

export default function Navbar() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  // Вошедшему пользователю вместо «Вход» показываем «Выйти».
  const links = user ? LINKS.filter((l) => l.to !== '/login') : [...LINKS]
  if (user)
    links.splice(2, 0, { to: '/diary', label: 'Дневник', icon: 'diary' }, { to: '/gallery', label: 'Галерея', icon: 'gallery' })
  // Ссылку на CRM видит только тренер; спортсменам панель по-прежнему не видна.
  const staff = ['admin', 'coach'].includes(profile?.role)
  if (staff) links.push({ to: '/admin', label: 'Тренер', icon: 'coach' })
  // Ученик отмечается по QR: круглая кнопка в середине нижнего меню (тренер код показывает, а не сканирует).
  const canScan = Boolean(user && profile && !staff)
  const [scanning, setScanning] = useState(false)
  const closeScanner = useCallback(() => setScanning(false), [])
  const scanAt = canScan ? Math.min(2, links.length) : -1
  // 6+ пунктов в нижнем меню — подписи мельче, чтобы не налезали.
  const tabText = links.length + (user ? 1 : 0) + (canScan ? 1 : 0) > 5 ? 'text-[10px] tracking-normal' : 'text-[11px] tracking-wider'
  const onSignOut = async () => {
    await signOut()
    navigate('/')
  }

  return (
    <>
      {/* Desktop: верхний навбар */}
      <header className="fixed inset-x-0 top-0 z-50 hidden border-b border-line bg-ink/95 backdrop-blur md:block">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="h-6 w-1.5 bg-accent" />
            <span className="font-display text-lg uppercase tracking-widest">
              Daugavpils <span className="text-accent">Top Team</span>
            </span>
          </Link>
          <nav className="flex items-center gap-8">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `font-display text-sm uppercase tracking-wider transition-colors ${
                    isActive ? 'text-accent' : 'text-neutral-300 hover:text-white'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
            {user ? (
              <button onClick={onSignOut} className="btn-outline !py-2">
                Выйти
              </button>
            ) : (
              <Link to="/register" className="btn-primary !py-2">
                Записаться
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Mobile: верхняя полоса с логотипом */}
      <header className="flex h-14 items-center gap-2 border-b border-line px-4 md:hidden">
        <span className="h-5 w-1.5 bg-accent" />
        <span className="font-display uppercase tracking-widest">
          DTT <span className="text-accent">&</span> Grappling
        </span>
      </header>

      {/* Mobile: нижний таб-бар */}
      <nav className="fixed inset-x-0 bottom-0 z-50 grid auto-cols-fr grid-flow-col border-t border-line bg-ink pb-[env(safe-area-inset-bottom)] md:hidden">
        {links.flatMap((l, i) => [
          i === scanAt && (
            <button
              key="qr"
              type="button"
              onClick={() => setScanning(true)}
              aria-label="Отметиться по QR-коду"
              className={`flex flex-col items-center gap-1 pb-2.5 font-semibold uppercase ${tabText} text-white`}
            >
              <span className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent shadow-[0_0_20px_-4px] shadow-accent/70 ring-4 ring-ink active:scale-95">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d={QR_ICON} />
                </svg>
              </span>
              QR
            </button>
          ),
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `relative flex flex-col items-center gap-1 py-2.5 font-semibold uppercase ${tabText} ${
                isActive ? 'text-accent' : 'text-neutral-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute inset-x-6 top-0 h-0.5 bg-accent" />}
                <Icon d={ICONS[l.icon]} />
                {l.label}
              </>
            )}
          </NavLink>,
        ].filter(Boolean))}
        {user && (
          <button
            onClick={onSignOut}
            className={`flex flex-col items-center gap-1 py-2.5 font-semibold uppercase ${tabText} text-neutral-400`}
          >
            <Icon d={ICONS.logout} />
            Выйти
          </button>
        )}
      </nav>

      {scanning && (
        <Suspense fallback={null}>
          <QrScanner onClose={closeScanner} />
        </Suspense>
      )}
    </>
  )
}
